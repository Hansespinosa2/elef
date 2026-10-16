require "test_helper"

class PresentationsRemoteImageFetcherTest < ActiveSupport::TestCase
  Fetcher = Presentations::PptxExport::RemoteImageFetcher

  class RedirectResponse < Net::HTTPFound
    def initialize(location)
      super("1.1", "302", "Found")
      instance_variable_set(:@header, { "location" => [location] })
    end
  end

  class ImageResponse < Net::HTTPOK
    def initialize(bytes, content_type: "image/png")
      super("1.1", "200", "OK")
      @bytes = bytes
      instance_variable_set(:@header, { "content-type" => [content_type] })
    end

    def content_length
      @bytes.bytesize
    end

    def read_body
      yield @bytes
    end
  end

  class StubHttp
    attr_accessor :ipaddr, :use_ssl, :verify_mode, :open_timeout, :read_timeout
    attr_reader :host, :port, :proxy, :requests

    def initialize(host, port, proxy, response)
      @host = host
      @port = port
      @proxy = proxy
      @response = response
      @requests = []
    end

    def start
      yield self
    end

    def request(request)
      @requests << request
      yield @response if block_given?
      @response
    end
  end

  test "a public URL redirecting to a private address is rejected before connecting" do
    resolved_hosts = []
    clients = []
    resolver = ->(host) {
      resolved_hosts << host
      host == "public.example" ? ["8.8.8.8"] : ["127.0.0.1"]
    }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, RedirectResponse.new("https://private.example/secret.png"))
      clients << client
      client
    }

    error = assert_raises(Presentations::PptxExport::Error) do
      Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://public.example/image.png")
    end

    assert_match(/resolve to public internet addresses/, error.message)
    assert_equal ["public.example", "private.example"], resolved_hosts
    assert_equal ["public.example"], clients.map(&:host)
  end

  test "a hostname that changes from public to private DNS on redirect is rejected" do
    resolved_hosts = []
    clients = []
    resolver_calls = Hash.new(0)
    resolver = ->(host) {
      resolved_hosts << host
      resolver_calls[host] += 1
      resolver_calls[host] == 1 ? ["8.8.8.8"] : ["127.0.0.1"]
    }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, RedirectResponse.new("/second.png"))
      clients << client
      client
    }

    assert_raises(Presentations::PptxExport::Error) do
      Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://rebound.example/first.png")
    end

    assert_equal ["rebound.example", "rebound.example"], resolved_hosts
    assert_equal ["rebound.example"], clients.map(&:host)
    assert_equal "8.8.8.8", clients.first.ipaddr
  end

  test "decimal, hexadecimal, and IPv4-mapped IPv6 loopback hosts are rejected" do
    representations = [
      ["2130706433", "2130706433", "127.0.0.1"],
      ["0x7f000001", "0x7f000001", "127.0.0.1"],
      ["[::ffff:127.0.0.1]", "::ffff:127.0.0.1", "::ffff:127.0.0.1"]
    ]

    representations.each do |authority, expected_host, resolved_address|
      resolved_hosts = []
      http_calls = 0
      resolver = ->(host) { resolved_hosts << host; [resolved_address] }
      http_factory = ->(*) { http_calls += 1; StubHttp.new("unexpected", 443, nil, ImageResponse.new("png")) }

      assert_raises(Presentations::PptxExport::Error) do
        Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://#{authority}/image.png")
      end

      assert_equal [expected_host], resolved_hosts
      assert_equal 0, http_calls, "#{authority} must be blocked before HTTP is constructed"
    end
  end

  test "disallowed protocols, ports, and credentials never reach the resolver" do
    resolved_hosts = []
    http_calls = 0
    resolver = ->(host) { resolved_hosts << host; ["8.8.8.8"] }
    http_factory = ->(*) { http_calls += 1; StubHttp.new("unexpected", 443, nil, ImageResponse.new("png")) }
    fetcher = Fetcher.new(address_resolver: resolver, http_factory: http_factory)

    [
      "http://public.example/image.png",
      "ftp://public.example/image.png",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "https://public.example:8443/image.png",
      "https://user:secret@public.example/image.png"
    ].each do |url|
      assert_raises(Presentations::PptxExport::Error) { fetcher.fetch(url) }
    end

    assert_empty resolved_hosts
    assert_equal 0, http_calls
  end

  test "a public redirect to HTTP is rejected before resolving its destination" do
    resolved_hosts = []
    clients = []
    resolver = ->(host) { resolved_hosts << host; ["8.8.8.8"] }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, RedirectResponse.new("http://public.example/image.png"))
      clients << client
      client
    }

    assert_raises(Presentations::PptxExport::Error) do
      Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://public.example/start.png")
    end

    assert_equal ["public.example"], resolved_hosts
    assert_equal ["public.example"], clients.map(&:host)
  end

  test "follows a public HTTPS redirect and re-resolves the destination before each request" do
    resolved_hosts = []
    clients = []
    responses = [RedirectResponse.new("/final.png"), ImageResponse.new("safe image bytes")]
    resolver = ->(host) {
      resolved_hosts << host
      resolved_hosts.length == 1 ? ["8.8.8.8"] : ["1.1.1.1"]
    }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, responses.shift)
      clients << client
      client
    }

    image = Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://public.example/start.png")

    assert_equal "safe image bytes", image.bytes
    assert_equal ["public.example", "public.example"], resolved_hosts
    assert_equal ["8.8.8.8", "1.1.1.1"], clients.map(&:ipaddr)
    assert_equal "/start.png", clients.first.requests.first.path
    assert_equal "/final.png", clients.last.requests.first.path
  end

  test "stops after the redirect limit" do
    resolved_hosts = []
    clients = []
    resolver = ->(host) { resolved_hosts << host; ["8.8.8.8"] }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, RedirectResponse.new("/next.png"))
      clients << client
      client
    }

    error = assert_raises(Presentations::PptxExport::Error) do
      Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://public.example/start.png")
    end

    assert_match(/redirects too many times/, error.message)
    assert_equal Fetcher::MAX_REDIRECTS + 1, resolved_hosts.length
    assert_equal Fetcher::MAX_REDIRECTS + 1, clients.length
  end

  test "pins a public resolved address and returns image bytes without opening a socket" do
    client = nil
    resolver = ->(host) { assert_equal "public.example", host; ["8.8.8.8"] }
    http_factory = ->(host, port, proxy) {
      client = StubHttp.new(host, port, proxy, ImageResponse.new("fake PNG bytes"))
    }

    image = Fetcher.new(address_resolver: resolver, http_factory: http_factory).fetch("https://public.example/image.png")

    assert_equal "fake PNG bytes", image.bytes
    assert_equal "image/png", image.content_type
    assert_equal "8.8.8.8", client.ipaddr
    assert_equal true, client.use_ssl
    assert_equal OpenSSL::SSL::VERIFY_PEER, client.verify_mode
    assert_nil client.proxy
    assert_equal "identity", client.requests.first["Accept-Encoding"]
  end
end
