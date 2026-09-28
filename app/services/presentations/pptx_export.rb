require "ipaddr"
require "base64"
require "net/http"
require "nokogiri"
require "openssl"
require "uri"

module Presentations
  class PptxExport
    class Error < StandardError; end

    WIDTH = 1280
    HEIGHT = 720
    MAX_REMOTE_IMAGE_BYTES = 10.megabytes
    MAX_REMOTE_IMAGES_BYTES = 30.megabytes

    FONTS = {
      "body" => 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      "book" => '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
      "modern" => 'Baskerville, "Iowan Old Style", Georgia, serif',
      "technical" => 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      "code" => '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    }.freeze

    BLOCKED_NETWORKS = %w[
      0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16
      172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16
      198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4
      ::/128 ::1/128 ::ffff:0:0/96 64:ff9b::/96 64:ff9b:1::/48 100::/64
      2001::/23 2001:db8::/32 2002::/16 fc00::/7 fe80::/10 fec0::/10 ff00::/8
    ].map { |network| IPAddr.new(network) }.freeze

    def initialize(presentation, version: "draft", release_id: nil)
      @presentation = presentation
      @version = version.to_s
      @release_id = release_id
      @remote_images = {}
      @remote_image_bytes = 0
    end

    def as_json(*)
      document = @presentation.parsed_document
      {
        filename: filename,
        version: @version,
        presentation: {
          title: @presentation.title.to_s,
          theme: @presentation.theme,
          typography: @presentation.typography,
          width: WIDTH,
          height: HEIGHT,
          fonts: FONTS
        },
        margin_settings: document.margin_settings.to_h.transform_keys(&:to_s),
        slides: document.slides.map { |slide| slide_payload(slide) }
      }
    end

    private

    def filename
      basename = Source::Document.normalize_folder_name(@presentation.title, fallback: "Presentation")
      "#{basename}.pptx"
    end

    def slide_payload(slide)
      {
        index: slide.index,
        layout: slide.layout,
        title_html: slide.title.present? ? markdown_html(slide.title) : nil,
        blocks: slide.blocks.map { |block| block_payload(block) },
        regions: slide.regions.map { |region| region.blocks.map { |block| block_payload(block) } },
        section: slide.section,
        subsection: slide.subsection,
        footnote_html: slide.footnote.present? ? markdown_html(slide.footnote) : nil
      }
    end

    def block_payload(block)
      {
        html: markdown_html(block.markdown),
        position: block.position&.to_h
      }
    end

    def markdown_html(markdown)
      html = Source::Renderer.render(markdown, media_resolver: method(:resolve_asset))
      fragment = Nokogiri::HTML::DocumentFragment.parse(html.to_s)
      fragment.css("img[src]").each do |image|
        source = image["src"].to_s
        next unless remote_image_url?(source)

        image["src"] = remote_image_data_uri(source)
      end
      fragment.to_html
    end

    def resolve_asset(digest)
      blob = (@asset_index ||= WorkAssets.index(@presentation))[digest]
      raise Error, "A referenced Elef image or video is unavailable for PPTX export." unless blob

      path = Rails.application.routes.url_helpers.pptx_asset_presentation_path(
        id: @presentation.id,
        digest: digest,
        version: @version,
        release_id: @release_id,
        script_name: Rails.application.config.relative_url_root
      )
      [path, blob.content_type]
    end

    def remote_image_url?(source)
      source.start_with?("https://", "http://", "//")
    end

    def remote_image_data_uri(source)
      canonical_url = source.start_with?("//") ? "https:#{source}" : source
      return @remote_images[canonical_url] if @remote_images.key?(canonical_url)

      image = RemoteImageFetcher.fetch(canonical_url)
      unless image.content_type.match?(%r{\Aimage/(?:png|jpe?g|gif|webp|svg\+xml)\z}i)
        raise Error, "A linked image uses an unsupported image format."
      end
      if image.bytes.bytesize > MAX_REMOTE_IMAGE_BYTES
        raise Error, "A linked image exceeds the 10 MB PPTX export limit."
      end

      @remote_image_bytes += image.bytes.bytesize
      if @remote_image_bytes > MAX_REMOTE_IMAGES_BYTES
        raise Error, "Linked images exceed the 30 MB PPTX export limit."
      end

      @remote_images[canonical_url] = "data:#{image.content_type};base64,#{Base64.strict_encode64(image.bytes)}"
    end

    class RemoteImageFetcher
      Image = Data.define(:bytes, :content_type)
      MAX_REDIRECTS = 3

      class << self
        def fetch(url)
          request(URI.parse(url), redirects: 0)
        rescue Error
          raise
        rescue StandardError
          raise Error, "A linked image could not be fetched for PPTX export."
        end

        private

        def request(uri, redirects:)
          unless uri.is_a?(URI::HTTPS) && uri.hostname.present? && uri.port == 443 && uri.userinfo.nil?
            raise Error, "Only public HTTPS images on port 443 can be embedded in a PPTX."
          end
          raise Error, "A linked image redirects too many times." if redirects > MAX_REDIRECTS

          address = public_address_for(uri.hostname)
          http = Net::HTTP.new(uri.hostname, uri.port, nil)
          http.ipaddr = address
          http.use_ssl = true
          http.verify_mode = OpenSSL::SSL::VERIFY_PEER
          http.open_timeout = 3
          http.read_timeout = 5
          http.write_timeout = 5 if http.respond_to?(:write_timeout=)
          http.max_retries = 0 if http.respond_to?(:max_retries=)

          response = nil
          image = nil
          http.start do |connection|
            request = Net::HTTP::Get.new(uri.request_uri)
            request["Accept"] = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            request["Accept-Encoding"] = "identity"
            response = connection.request(request) do |result|
              if result.is_a?(Net::HTTPRedirection)
                next
              end
              raise Error, "A linked image could not be fetched for PPTX export." unless result.is_a?(Net::HTTPSuccess)

              content_type = result["content-type"].to_s.split(";", 2).first.to_s.downcase
              body = +"".b
              if result.content_length && result.content_length > MAX_REMOTE_IMAGE_BYTES
                raise Error, "A linked image exceeds the 10 MB PPTX export limit."
              end
              result.read_body do |chunk|
                body << chunk
                raise Error, "A linked image exceeds the 10 MB PPTX export limit." if body.bytesize > MAX_REMOTE_IMAGE_BYTES
              end
              image = Image.new(body, content_type)
            end
          end

          if response.is_a?(Net::HTTPRedirection)
            location = response["location"]
            raise Error, "A linked image redirected without a destination." if location.blank?
            return request(URI.join(uri.to_s, location), redirects: redirects + 1)
          end

          image
        end

        def public_address_for(host)
          addresses = Addrinfo.getaddrinfo(host, nil, nil, :STREAM).map(&:ip_address).uniq
          raise Error, "A linked image host could not be resolved." if addresses.empty?

          parsed = addresses.map { |address| IPAddr.new(address) }
          if parsed.any? { |address| blocked_address?(address) }
            raise Error, "A linked image host must resolve to public internet addresses."
          end

          parsed.first.to_s
        end

        def blocked_address?(address)
          normalized = address.ipv4_mapped? ? address.native : address
          BLOCKED_NETWORKS.any? { |network| network.include?(normalized) }
        end
      end
    end
  end
end
