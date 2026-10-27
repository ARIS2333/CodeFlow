import unittest
from unittest.mock import patch

import app as backend_app


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.client = backend_app.app.test_client()

    def test_summary_requires_admin_auth_and_never_queries_for_invalid_token(self):
        with patch.dict('os.environ', {'ADMIN_PASSWORD': 'test-only'}), patch.object(backend_app, 'admin_study_summary') as query:
            self.assertEqual(self.client.get('/api/admin/summary').status_code, 401)
            self.assertEqual(self.client.get('/api/admin/summary', headers={'Authorization': 'Bearer forged'}).status_code, 401)
            query.assert_not_called()

    def test_login_and_authorized_read(self):
        data = {'participants': [], 'totals': {'totalTokens': 123, 'estimatedCostUsd': 0.02}}
        with patch.dict('os.environ', {'ADMIN_PASSWORD': 'test-only'}), patch.object(backend_app, 'admin_study_summary', return_value=data):
            self.assertEqual(self.client.post('/api/admin/login', json={'password': 'wrong'}).status_code, 401)
            login = self.client.post('/api/admin/login', json={'password': 'test-only'})
            self.assertEqual(login.status_code, 200)
            response = self.client.get('/api/admin/summary', headers={'Authorization': 'Bearer ' + login.get_json()['token']})
            self.assertEqual(response.get_json(), data)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_unconfigured_admin_is_disabled(self):
        with patch.dict('os.environ', {'ADMIN_PASSWORD': ''}):
            self.assertEqual(self.client.post('/api/admin/login', json={'password': ''}).status_code, 503)

    def test_expired_token_is_rejected(self):
        from itsdangerous import TimestampSigner
        with patch.dict('os.environ', {'ADMIN_PASSWORD': 'test-only'}):
            with patch.object(TimestampSigner, 'get_timestamp', return_value=1):
                token = backend_app.admin_signer().dumps({'role': 'admin'})
            self.assertEqual(self.client.get('/api/admin/summary', headers={'Authorization': 'Bearer ' + token}).status_code, 401)


if __name__ == '__main__':
    unittest.main()
