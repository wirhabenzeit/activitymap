require 'minitest/autorun'
require 'tempfile'
require_relative 'finish'

class AppStoreAuthenticationTest < Minitest::Test
  def test_jwt_has_a_valid_es256_signature_and_short_lifetime
    key = OpenSSL::PKey::EC.generate('prime256v1')
    Tempfile.create('testflight-test-key') do |file|
      file.write(key.to_pem)
      file.flush
      api = AppStoreConnect.new(file.path, 'TESTKEY', 'test-issuer')
      header, payload, signature = api.token.split('.')
      assert_equal 'TESTKEY', JSON.parse(Base64.urlsafe_decode64(header))['kid']
      claims = JSON.parse(Base64.urlsafe_decode64(payload))
      assert_equal 'appstoreconnect-v1', claims['aud']
      assert_equal 'test-issuer', claims['iss']
      assert_operator claims['exp'] - Time.now.to_i, :<=, 600
      raw = Base64.urlsafe_decode64(signature)
      assert_equal 64, raw.bytesize
      integers = [raw[0,32], raw[32,32]].map { |v| OpenSSL::ASN1::Integer.new(OpenSSL::BN.new(v, 2)) }
      assert key.verify('SHA256', OpenSSL::ASN1::Sequence.new(integers).to_der, "#{header}.#{payload}")
    end
  end
end
