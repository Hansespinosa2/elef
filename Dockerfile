FROM ruby:3.4-bookworm

ENV APP_HOME=/rails \
    BUNDLE_DEPLOYMENT=1 \
    BUNDLE_PATH=/usr/local/bundle \
    BUNDLE_WITHOUT=development:test \
    RAILS_ENV=production

RUN apt-get update \
  && apt-get install --no-install-recommends -y build-essential ca-certificates curl libpq-dev nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR ${APP_HOME}

COPY Gemfile Gemfile.lock ./
RUN bundle install \
  && rm -rf /root/.bundle/cache /usr/local/bundle/cache

COPY . .

# Propshaft and Tailwind assets are compiled into the image. The dummy values
# let Rails load its production configuration without contacting PostgreSQL
# during the image build.
RUN SECRET_KEY_BASE=dummy-secret-for-image-build \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/elef \
    bundle exec rails assets:precompile

RUN groupadd --system --gid 10001 elef \
  && useradd --system --uid 10001 --gid 10001 --home-dir ${APP_HOME} --shell /usr/sbin/nologin elef \
  && mkdir -p ${APP_HOME}/log ${APP_HOME}/storage ${APP_HOME}/tmp/pids \
  && chown -R elef:elef ${APP_HOME}

USER elef

EXPOSE 3000

CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
