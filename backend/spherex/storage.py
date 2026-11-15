"""Private product storage. No archive retrieval, cloud provisioning or public URLs here."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

CHUNK = 1024 * 1024


class StoreError(OSError):
    pass


def key_checked(key):
    if not isinstance(key, str) or not key or '\\' in key or key.startswith('/') or any(
        p in ('', '.', '..') for p in key.split('/')
    ) or str(PurePosixPath(key)) != key:
        raise ValueError('Invalid storage key')
    return key


class Store:
    def exists(self, key):
        raise NotImplementedError

    def read(self, key, limit=8 * CHUNK):
        chunks, size = [], 0
        for block in self.stream(key):
            size += len(block)
            if size > limit:
                raise StoreError('Stored object exceeds limit')
            chunks.append(block)
        return b''.join(chunks)

    def json(self, key, limit=8 * CHUNK):
        try:
            return json.loads(self.read(key, limit=limit))
        except (ValueError, UnicodeError) as exc:
            raise StoreError('Invalid stored JSON') from exc

    def put_json(self, key, value):
        data = json.dumps(value, allow_nan=False, sort_keys=True).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'object'
            path.write_bytes(data)
            self.put_file(key, path)


class LocalStore(Store):
    def __init__(self, root):
        self.root = Path(root).resolve()

    def path(self, key):
        path = (self.root / key_checked(key)).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError('Storage path escapes root')
        return path

    def stream(self, key):
        try:
            with self.path(key).open('rb') as handle:
                while block := handle.read(CHUNK):
                    yield block
        except OSError as exc:
            raise StoreError('Cannot read stored object') from exc

    def exists(self, key):
        return self.path(key).is_file()

    def put_file(self, key, source):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        staged = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as dest:
                staged = Path(dest.name)
                with Path(source).open('rb') as src:
                    while block := src.read(CHUNK):
                        dest.write(block)
            os.replace(staged, path)
        finally:
            if staged:
                staged.unlink(missing_ok=True)


class GcsStore(Store):
    def __init__(self, bucket, prefix='blink3', client=None):
        if client is None:
            from google.cloud import storage
            client = storage.Client()  # attached service identity / ADC, never a key file in Git
        self.bucket = client.bucket(bucket)
        self.prefix = key_checked(prefix) if prefix else ''

    def blob(self, key):
        return self.bucket.blob('/'.join(filter(None, [self.prefix, key_checked(key)])))

    def stream(self, key):
        try:
            with self.blob(key).open('rb', chunk_size=CHUNK, timeout=20) as handle:
                while block := handle.read(CHUNK):
                    yield block
        except Exception as exc:
            raise StoreError('Cloud storage could not be read') from exc

    def exists(self, key):
        try:
            return self.blob(key).exists()
        except Exception as exc:
            raise StoreError('Cloud storage could not be checked') from exc

    def put_file(self, key, source):
        try:
            self.blob(key).upload_from_filename(str(source), timeout=120)
        except Exception as exc:
            raise StoreError('Cloud storage could not be written') from exc


def from_env():
    bucket = os.getenv('BLINK_GCS_BUCKET', '')
    return GcsStore(bucket, os.getenv('BLINK_GCS_PREFIX', 'blink3')) if bucket else LocalStore(
        os.getenv('BLINK_STORE_DIR', 'backend/data/cloud-store'))


def digest_file(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def download_verified(store, asset, path, limit):
    """Materialize a bounded, checksummed private input; never expose its object key as a URL."""
    if not 0 < asset['sizeBytes'] <= limit:
        raise StoreError('Input exceeds the size limit')
    size, digest = 0, hashlib.sha256()
    try:
        with Path(path).open('wb') as handle:
            for block in store.stream(asset['key']):
                size += len(block)
                if size > asset['sizeBytes']:
                    raise StoreError('Input size mismatch')
                digest.update(block)
                handle.write(block)
        if size != asset['sizeBytes'] or digest.hexdigest() != asset['sha256']:
            raise StoreError('Input checksum or size mismatch')
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise
