import unittest
from metadata import build_number, release_version


class ReleaseMetadataTests(unittest.TestCase):
    def test_release_and_prerelease_share_marketing_version(self):
        self.assertEqual(release_version('ios/v1.2.3'), '1.2.3')
        self.assertEqual(release_version('ios/v1.2.3-beta.2'), '1.2.3')

    def test_unrelated_and_malformed_tags_fail(self):
        for tag in ['v1.2.3', 'ios/v1.2', 'ios/v1.2.3\n', 'ios/v1.2.3;echo bad']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release_version(tag)

    def test_reruns_and_new_releases_increase_build_number(self):
        self.assertEqual(build_number('1', '1'), '101.1')
        self.assertEqual(build_number('1', '2'), '101.2')
        self.assertEqual(build_number('2', '1'), '102.1')

    def test_apple_component_limits(self):
        self.assertEqual(build_number('9899', '99'), '9999.99')
        for run, attempt in [('9900','1'), ('1','100'), ('0','1'), ('1','0')]:
            with self.subTest(run=run, attempt=attempt), self.assertRaises(ValueError):
                build_number(run, attempt)


if __name__ == '__main__':
    unittest.main()
