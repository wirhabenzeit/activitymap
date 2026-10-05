#!/usr/bin/env ruby
# Uses only Ruby's standard library; the API key never goes into a log or artifact.
require 'base64'
require 'json'
require 'net/http'
require 'openssl'

class AppStoreConnect
  def initialize(key_path, key_id, issuer_id)
    @key = OpenSSL::PKey.read(File.read(key_path))
    @key_id, @issuer_id = key_id, issuer_id
  end

  def token
    encode = ->(value) { Base64.urlsafe_encode64(value, padding: false) }
    header = { alg: 'ES256', kid: @key_id, typ: 'JWT' }
    payload = { iss: @issuer_id, iat: Time.now.to_i - 10, exp: Time.now.to_i + 600, aud: 'appstoreconnect-v1' }
    unsigned = [header, payload].map { |v| encode.call(JSON.generate(v)) }.join('.')
    der = @key.sign('SHA256', unsigned)
    # JOSE signatures use two fixed-width integers, not ASN.1 DER.
    raw = OpenSSL::ASN1.decode(der).value.map { |i| i.value.to_s(2).rjust(32, "\0") }.join
    "#{unsigned}.#{encode.call(raw)}"
  end

  def request(method, path, body = nil)
    uri = URI("https://api.appstoreconnect.apple.com#{path}")
    req = Net::HTTP.const_get(method.capitalize).new(uri)
    req['Authorization'] = "Bearer #{token}"
    req['Content-Type'] = 'application/json'
    req.body = JSON.generate(body) if body
    result = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 30, read_timeout: 60) { |http| http.request(req) }
    unless result.is_a?(Net::HTTPSuccess)
      raise "App Store Connect #{method} #{path.split('?').first}: HTTP #{result.code}: #{result.body}"
    end
    result.body.to_s.empty? ? {} : JSON.parse(result.body)
  end
end

if $PROGRAM_NAME == __FILE__
  root = ENV.fetch('RUNNER_TEMP')
  api = AppStoreConnect.new("#{root}/testflight-private/AuthKey.p8",
                            ENV.fetch('APP_STORE_CONNECT_KEY_ID'), ENV.fetch('APP_STORE_CONNECT_ISSUER_ID'))
  source = JSON.parse(File.read("#{root}/testflight-output/source.json"))
  query = URI.encode_www_form('filter[app]' => ENV.fetch('APP_STORE_APP_ID'),
                              'filter[version]' => source.fetch('build'),
                              'include' => 'preReleaseVersion', 'limit' => '20')
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 18 * 60
  build = nil
  loop do
    response = api.request('get', "/v1/builds?#{query}")
    versions = (response['included'] || []).to_h { |v| [v['id'], v.dig('attributes', 'version')] }
    build = response.fetch('data').find do |b|
      versions[b.dig('relationships', 'preReleaseVersion', 'data', 'id')] == source.fetch('version')
    end
    state = build&.dig('attributes', 'processingState')
    puts "Apple processing: #{state || 'waiting for uploaded build'}"
    break if state == 'VALID'
    abort "Apple rejected build processing: #{state}" if %w[FAILED INVALID].include?(state)
    abort 'Upload completed, but Apple processing timed out. Check TestFlight before retrying.' if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    sleep 30
  end

  event = JSON.parse(File.read(ENV.fetch('GITHUB_EVENT_PATH')))
  notes = "#{source.fetch('release_tag')}\nSource: #{source.fetch('source_commit')}\n\n#{event.dig('release', 'body')}"[0, 4000]
  existing = api.request('get', "/v1/builds/#{build.fetch('id')}/betaBuildLocalizations").fetch('data')
                .find { |l| l.dig('attributes', 'locale') == 'en-US' }
  if existing
    api.request('patch', "/v1/betaBuildLocalizations/#{existing.fetch('id')}",
                data: { type: 'betaBuildLocalizations', id: existing.fetch('id'), attributes: { whatsNew: notes } })
  else
    api.request('post', '/v1/betaBuildLocalizations', data: { type: 'betaBuildLocalizations',
                attributes: { locale: 'en-US', whatsNew: notes },
                relationships: { build: { data: { type: 'builds', id: build.fetch('id') } } } })
  end
  source['app_store_build_id'] = build.fetch('id')
  source['processing_state'] = 'VALID'
  File.write("#{root}/testflight-output/source.json", JSON.pretty_generate(source) + "\n")
  url = "https://appstoreconnect.apple.com/apps/#{ENV.fetch('APP_STORE_APP_ID')}/testflight/ios/#{build.fetch('id')}"
  File.open(ENV.fetch('GITHUB_STEP_SUMMARY'), 'a') do |f|
    f.puts "## TestFlight upload accepted\n\nVersion: **#{source['version']} (#{source['build']})**\n\nSource: `#{source['source_commit']}`\n\n[Open TestFlight](#{url})\n\nApple processing is VALID and release notes are saved. Internal Testing uses automatic distribution."
  end
  puts "Apple accepted #{source['version']} (#{source['build']}); TestFlight notes saved."
end
