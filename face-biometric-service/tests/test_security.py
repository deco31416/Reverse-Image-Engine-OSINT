import base64
from io import BytesIO
import os
import unittest
from unittest.mock import patch

os.environ.setdefault('FACE_BIOMETRIC_API_KEY', 'unit-test-key')

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.security import decode_image_base64, validate_image_dimensions, RequestSizeLimit
from app.config import settings


class SecurityTests(unittest.TestCase):
    def test_base64_size_is_checked_before_decoding(self):
        value = 'A' * (4 * ((settings.max_image_mb * 1024 * 1024 + 2) // 3) + 129)
        with patch('app.security.base64.b64decode') as decode:
            with self.assertRaises(HTTPException) as error:
                decode_image_base64(value)
            self.assertEqual(error.exception.status_code, 413)
            decode.assert_not_called()

    def test_image_dimensions_and_format(self):
        image = Image.new('RGB', (16, 16))
        output = BytesIO()
        image.save(output, 'PNG')
        validate_image_dimensions(output.getvalue())
        with self.assertRaises(HTTPException):
            validate_image_dimensions(b'not an image')

    def test_api_key_and_embedding_validation(self):
        client = TestClient(app)
        body = {'firstEmbedding': [1.0] * 128, 'secondEmbedding': [1.0] * 128}
        self.assertEqual(client.post('/v1/faces/compare', json=body).status_code, 401)
        headers = {'x-api-key': settings.internal_api_key}
        result = client.post('/v1/faces/compare', json=body, headers=headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['classification'], 'probable')
        body['firstEmbedding'] = [1.0] * 129
        self.assertEqual(client.post('/v1/faces/compare', json=body, headers=headers).status_code, 422)

    def test_chunked_request_limit(self):
        import asyncio
        messages = [{'type': 'http.request', 'body': b'x' * 5, 'more_body': True}] * 3
        responses = []
        called = []
        async def receive(): return messages.pop(0)
        async def send(message): responses.append(message)
        async def downstream(*args): called.append(True)
        limiter = RequestSizeLimit(downstream)
        limiter.limit = 8
        asyncio.run(limiter({'type': 'http'}, receive, send))
        self.assertEqual(responses[0]['status'], 413)
        self.assertFalse(called)


if __name__ == '__main__':
    unittest.main()
