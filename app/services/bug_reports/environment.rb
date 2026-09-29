module BugReports
  class Environment
    def initialize(user_agent:, build_id: ENV["ELEF_BUILD_ID"].presence || ENV["GIT_COMMIT"].presence, rails_version: Rails.version)
      @user_agent = user_agent.to_s.first(500)
      @build_id = build_id.presence || "unavailable"
      @rails_version = rails_version
    end

    def to_s
      "Elef build: #{@build_id}; Rails: #{@rails_version}; Browser: #{browser}; OS: #{operating_system}"
    end

    private

    def browser
      return "Edge #{version_for(/Edg\/([\d.]+)/)}" if @user_agent.match?(/Edg\//)
      return "Opera #{version_for(/(?:OPR|Opera)\/([\d.]+)/)}" if @user_agent.match?(/(?:OPR|Opera)\//)
      return "Firefox #{version_for(/Firefox\/([\d.]+)/)}" if @user_agent.match?(/Firefox\//)
      return "Chrome #{version_for(/Chrome\/([\d.]+)/)}" if @user_agent.match?(/Chrome\//)
      return "Safari #{version_for(/Version\/([\d.]+)/)}" if @user_agent.match?(/Safari\//)

      "Unknown browser"
    end

    def operating_system
      return "Windows" if @user_agent.match?(/Windows NT/i)
      return "iOS" if @user_agent.match?(/(?:iPhone|iPad|iPod)/i)
      return "Android" if @user_agent.match?(/Android/i)
      return "macOS" if @user_agent.match?(/Macintosh|Mac OS X/i)
      return "ChromeOS" if @user_agent.match?(/CrOS/i)
      return "Linux" if @user_agent.match?(/Linux/i)

      "Unknown OS"
    end

    def version_for(pattern)
      @user_agent.match(pattern)&.captures&.first || "unknown version"
    end
  end
end
