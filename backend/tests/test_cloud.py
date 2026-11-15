"""Cloud integration with generated SYNTHETIC FITS and local/fake stores; no archive/cloud traffic."""
import copy
from io import BytesIO
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from spherex import cache
import spherex.cloud_job as cloud_job_module
from spherex.storage import LocalStore, GcsStore, StoreError, digest_file
from spherex.cloud_job import prepare, execute, validate_plan
from spherex.archive_plan import make_plan, votable, safe_url
from spherex.query import read_frame_file
from spherex.products import build
from spherex.photometry import measure
from cloud_app import create_app


def test_archive_retry_is_bounded_and_respects_delay():
    from urllib.error import HTTPError
    from spherex.cloud_job import open_input
    calls, waits = [], []
    def busy(url):
        calls.append(url)
        raise HTTPError(url, 503, 'Busy', {'Retry-After': '5'}, BytesIO())
    with pytest.raises(HTTPError):
        open_input('https://irsa.ipac.caltech.edu/test', busy, waits.append)
    assert len(calls) == 8 and len(waits) == 7
    assert all(delay >= floor for delay, floor in zip(waits, [5, 10, 20, 40, 60, 60, 60]))
    def forbidden(url):
        raise HTTPError(url, 403, 'Denied', {}, BytesIO())
    with pytest.raises(HTTPError):
        open_input('https://irsa.ipac.caltech.edu/test', forbidden, lambda _: pytest.fail('must not retry'))
    def long_wait(url):
        raise HTTPError(url, 503, 'Busy', {'Retry-After': '120'}, BytesIO())
    attempts, long_waits = [], []
    def succeeds_after_long_retry(url):
        attempts.append(url)
        if len(attempts) == 1: return long_wait(url)
        return BytesIO(b'ok')
    from spherex.cloud_job import open_input
    with open_input('https://irsa.ipac.caltech.edu/test', succeeds_after_long_retry, long_waits.append) as response:
        assert response.read() == b'ok'
    assert len(long_waits) == 1 and long_waits[0] >= 120


def test_monthly_execute_falls_back_until_a_verified_usable_image_is_found(tmp_path, monkeypatch):
    from urllib.error import HTTPError

    class Response(BytesIO):
        def __init__(self, content):
            super().__init__(content)
            self.headers = {}

    files = [
        {"obsId": "jan-404", "mjd": 61000.1, "month": "2025-01", "url": "https://irsa.ipac.caltech.edu/404.fits", "name": "input-000.fits"},
        {"obsId": "jan-no-coverage", "mjd": 61000.2, "month": "2025-01", "url": "https://irsa.ipac.caltech.edu/no-coverage.fits", "name": "input-001.fits"},
        {"obsId": "jan-good", "mjd": 61000.3, "month": "2025-01", "url": "https://irsa.ipac.caltech.edu/good.fits", "name": "input-002.fits"},
        {"obsId": "feb-good", "mjd": 61031.3, "month": "2025-02", "url": "https://irsa.ipac.caltech.edu/feb.fits", "name": "input-003.fits"},
    ]
    plan = {"version": 1, "sequenceId": "test-monthly-d1", "collection": "spherex_dr1",
            "query": {"ra": 10, "dec": -10, "fov": 5, "det": "D1"},
            "maxFileBytes": 1024, "maxTotalBytes": 4096, "downloadApproved": True,
            "samplingMode": "monthly", "requestedMonths": ["2025-01", "2025-02"],
            "monthGroups": [{"month": "2025-01", "obsIds": ["jan-404", "jan-no-coverage", "jan-good"]},
                            {"month": "2025-02", "obsIds": ["feb-good"]}],
            "files": files}
    calls = []

    def opener(url):
        calls.append(url)
        if url.endswith("404.fits"):
            raise HTTPError(url, 404, "Missing", {}, BytesIO())
        return Response(url.encode())

    def fake_prepare(prepared_plan, paths, _store, progress=None):
        assert [item["obsId"] for item in prepared_plan["files"]] == ["jan-good", "feb-good"]
        assert prepared_plan["monthlySelection"]["missingMonths"] == []
        assert [item["selectedObsId"] for item in prepared_plan["monthlySelection"]["monthResults"]] == ["jan-good", "feb-good"]
        assert [path.read_bytes() for path in paths] == [
            b"https://irsa.ipac.caltech.edu/good.fits", b"https://irsa.ipac.caltech.edu/feb.fits",
        ]
        return "manifest-key", {"frames": [1, 2], "monthlySelection": prepared_plan["monthlySelection"]}

    monkeypatch.setattr(cloud_job_module, "_verify_download", lambda *_args: "a" * 64)
    monkeypatch.setattr(cloud_job_module, "_monthly_candidate_is_usable",
                        lambda _path, _plan, record: record["obsId"] != "jan-no-coverage")
    monkeypatch.setattr(cloud_job_module, "prepare", fake_prepare)
    progress = []

    result = execute(plan, LocalStore(tmp_path / "monthly-store"), opener=opener,
                     sleep=lambda _seconds: None, progress=progress.append)

    assert result[0] == "manifest-key"
    assert calls == [file["url"] for file in files]
    assert [item["progress"] for item in progress] == sorted(item["progress"] for item in progress)


def test_monthly_fallback_bytes_stay_within_the_detector_cap(tmp_path, monkeypatch):
    class Response(BytesIO):
        def __init__(self, content):
            super().__init__(content)
            self.headers = {"Content-Length": str(len(content))}

    payload = b"verified-fit"
    files = [
        {"obsId": "jan-unusable", "mjd": 61000.1, "month": "2026-01",
         "url": "https://irsa.ipac.caltech.edu/unusable.fits", "name": "input-000.fits"},
        {"obsId": "jan-fallback", "mjd": 61000.2, "month": "2026-01",
         "url": "https://irsa.ipac.caltech.edu/fallback.fits", "name": "input-001.fits"},
    ]
    plan = {"version": 1, "sequenceId": "test-monthly-cap-d1", "collection": "spherex_dr1",
            "query": {"ra": 10, "dec": -10, "fov": 5, "det": "D1"},
            "maxFileBytes": 1024, "maxTotalBytes": len(payload), "downloadApproved": True,
            "samplingMode": "monthly", "requestedMonths": ["2026-01"],
            "monthGroups": [{"month": "2026-01", "obsIds": ["jan-unusable", "jan-fallback"]}],
            "files": files}
    opened = []

    def opener(url):
        opened.append(url)
        return Response(payload)

    monkeypatch.setattr(cloud_job_module, "_verify_download", lambda *_args: "a" * 64)
    monkeypatch.setattr(cloud_job_module, "_monthly_candidate_is_usable",
                        lambda _path, _plan, record: record["obsId"] == "jan-fallback")
    monkeypatch.setattr(cloud_job_module, "prepare",
                        lambda *_args, **_kwargs: pytest.fail("no image should fit the byte cap"))

    with pytest.raises(ValueError, match="No monthly SPHEREx observation"):
        execute(plan, LocalStore(tmp_path / "monthly-cap-store"), opener=opener,
                sleep=lambda _seconds: None)

    assert opened == [item["url"] for item in files]


@pytest.fixture
def product(tmp_path, write_frame):
    paths = [write_frame(mjd=60800+i*40, detector=2, stars=[(150, 20, 500)],
                         header_extra={'COMMENT': 'SYNTHETIC TEST FILE'})[0] for i in range(3)]
    plan = {'version': 1, 'sequenceId': 'test-d2', 'collection': 'spherex_dr1',
            'query': {'ra': 150, 'dec': 20, 'fov': 5, 'det': 'D2'},
            'maxFileBytes': 128*1024**2, 'maxTotalBytes': 128*1024**2,
            'termsChecked': True, 'acknowledgement': 'Synthetic test fixture only.',
            'files': [{'obsId': f'test-{i}', 'mjd': 60800+i*40, 'url': f'https://irsa.ipac.caltech.edu/test/{i}.fits',
                       'name': f'input-{i}.fits'} for i in range(3)]}
    store = LocalStore(tmp_path / 'store')
    key, doc = prepare(plan, paths, store, fixture=True)
    approved = [{'sequenceId': 'test-d2', 'manifest': key, 'termsChecked': True}]
    return store, plan, paths, key, doc, approved


def test_cloud_products_equal_local_bytes(product, tmp_path, monkeypatch):
    store, plan, paths, key, doc, approved = product
    out = tmp_path / 'local-cache'; out.mkdir()
    monkeypatch.setattr(cache, 'CACHE_DIR', out)
    files = [read_frame_file(p) for p in paths]
    frames = build(files, 150, 20, 5, files[0].pixel_scale_arcsec, 'local')
    for actual, expected in zip(doc['frames'], frames, strict=True):
        for name in ('mjd', 'dateISO', 'detector', 'provenance', 'unit', 'flags', 'wavelengthMinUm'):
            assert actual[name] == expected[name]
        for name in ('imageUrl', 'maskUrl', 'dataUrl'):
            assert store.read(doc['assets'][actual[name]]['key']) == (out / Path(expected[name]).name).read_bytes()


def test_http_contract_and_photometry(product):
    store, plan, paths, key, doc, approved = product
    client = TestClient(create_app(store, approved, pixels=True, origins=['https://iooonut.github.io'], public_base='https://blink.example'))
    r = client.get('/api/cutouts?ra=150&dec=20&fov=5&det=D2', headers={'Origin': 'https://iooonut.github.io'})
    assert r.status_code == 200
    assert r.headers['access-control-allow-origin'] == 'https://iooonut.github.io'
    frames = r.json()['frames']; assert len(frames) == 3
    assert frames[0]['imageUrl'].startswith('https://blink.example/api/sequences/')
    assert frames[0]['dataKind'] == 'synthetic'
    image = client.get(frames[0]['imageUrl']); assert image.status_code == 200
    assert image.content.startswith(b'\x89PNG')
    for ra, dec in [(150, 20), (150.0001, 20.0001)]:
        points = client.get(f'/api/photometry?ra={ra}&dec={dec}&det=D2&radius=2').json()['points']
        assert points == measure([read_frame_file(p) for p in paths], ra, dec, 2)
    assert client.get('/api/cutouts?ra=150&dec=20&fov=6&det=D2').status_code == 422
    too_wide = client.get('/api/cutouts?ra=150&dec=20&fov=10.1&det=D2')
    assert too_wide.status_code == 422
    assert "less than or equal to 10" in too_wide.text
    assert client.get('/api/sequences/unknown').status_code == 404
    assert client.get('/api/sequences/test-d2/assets/input-0.fits').status_code == 404
    assert client.get('/api/sequences/test-d2/assets/' + doc['revision'] + '/input-0.fits').status_code == 404
    assert client.get('/api/sequences/test-d2/assets/' + '0'*32 + '/' + doc['frames'][0]['dataUrl']).status_code == 404
    assert client.post('/api/sequences').status_code == 405
    assert 'access-control-allow-origin' not in client.get('/api/health', headers={'Origin': 'https://evil.example'}).headers
    assert client.get('/api/photometry?ra=150&dec=20&epoch_mjd=nan').status_code == 400


def test_gates_and_corruption(product):
    store, _, _, _, doc, approved = product
    off = TestClient(create_app(store, approved, pixels=False))
    assert off.get('/api/cutouts?ra=150&dec=20').status_code == 403
    assert off.get('/api/sequences/test-d2/assets/' + doc['revision'] + '/' + doc['frames'][0]['dataUrl']).status_code == 403
    assert TestClient(create_app(store, [], pixels=True)).get('/api/sequences').json() == {'sequences': []}
    unapproved = copy.deepcopy(approved); unapproved[0]['termsChecked'] = False
    assert TestClient(create_app(store, unapproved, pixels=True)).get('/api/sequences/test-d2').status_code == 404
    asset = doc['assets'][doc['frames'][0]['dataUrl']]
    store.path(asset['key']).write_bytes(b'bad')
    client = TestClient(create_app(store, approved, pixels=True))
    assert client.get('/api/sequences/test-d2/assets/' + doc['revision'] + '/' + doc['frames'][0]['dataUrl']).status_code == 503


def test_public_api_has_no_per_client_rate_limit_and_store_failure(product):
    store, _, _, _, _, approved = product
    client = TestClient(create_app(store, approved, pixels=True, rate=2))
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/health').status_code == 200
    missing = copy.deepcopy(approved); missing[0]['manifest'] = 'not-here.json'
    assert TestClient(create_app(store, missing)).get('/api/health').status_code == 503


def test_invalid_manifest_is_a_storage_failure(product):
    store, _, _, key, doc, approved = product
    for field in ('collection', 'processingVersion', 'frames'):
        invalid = copy.deepcopy(doc)
        del invalid[field]
        store.put_json(key, invalid)
        assert TestClient(create_app(store, approved)).get('/api/sequences').status_code == 503
    with pytest.raises(ValueError, match='HTTPS origin'):
        create_app(store, [], public_base='https://')


def test_failed_job_never_publishes_manifest(product, tmp_path):
    _, plan, paths, _, _, _ = product
    class FailingStore(LocalStore):
        def put_file(self, key, path):
            if '/private/' in key:
                raise StoreError('injected upload failure')
            super().put_file(key, path)
    store = FailingStore(tmp_path / 'failed')
    with pytest.raises(StoreError):
        prepare(plan, paths, store, fixture=True)
    assert not list(store.root.rglob('manifest.json'))
    with pytest.raises(ValueError, match='SPHEREx header'):
        prepare(plan, paths, store)


def test_job_retries_use_distinct_revisions(product):
    store, plan, paths, key, _, _ = product
    key2, _ = prepare(plan, paths, store, fixture=True)
    assert key != key2
    assert store.json(key)['revision'] != store.json(key2)['revision']


def test_download_gates_and_caps(product):
    store, plan, paths, _, _, _ = product
    with pytest.raises(ValueError, match='not approved'):
        execute(plan, store, opener=lambda _: pytest.fail('must not fetch'))
    plan['downloadApproved'] = True
    plan['maxFileBytes'] = 2
    class Fake(BytesIO):
        headers = {}
    with pytest.raises(ValueError, match='exceeds approved'):
        execute(plan, store, opener=lambda _: Fake(b'123'))
    plan['files'][1]['obsId'] = plan['files'][0]['obsId']
    with pytest.raises(ValueError, match='duplicate observation'):
        validate_plan(plan)


def test_metadata_resolution_and_no_pixels():
    xml = b'''<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE>
      <FIELD name="semantics"/><FIELD name="content_type"/><FIELD name="access_url"/><FIELD name="content_length"/>
      <DATA><TABLEDATA><TR><TD>#this</TD><TD>application/fits</TD><TD>https://irsa.ipac.caltech.edu/data/a.fits</TD><TD>12345</TD></TR></TABLEDATA></DATA>
      </TABLE></RESOURCE></VOTABLE>'''
    row = {'obs_collection': 'spherex_dr1', 'energy_bandpassname': 'SPHEREx-D2', 't_min': '60800',
           'obs_id': 'one', 'access_url': 'https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=one', 'access_format': 'datalink'}
    calls = []
    def fetch(url):
        calls.append(url); return xml
    plan = make_plan([row, row], ra=150, dec=20, fov=5, fetch=fetch)
    assert len(calls) == 1 and '/datalink/' in calls[0]
    assert len(plan['files']) == 1 and plan['files'][0]['estimatedBytes'] == 12345
    assert not plan['downloadApproved']
    with pytest.raises(ValueError, match='truncated'):
        votable(xml.replace(b'value="OK"', b'value="OVERFLOW"'))
    for url in ['http://irsa.ipac.caltech.edu/a', 'https://evil.example/a', 'https://user@irsa.ipac.caltech.edu/a']:
        with pytest.raises(ValueError): safe_url(url)


def test_local_store_traversal_and_symlink(tmp_path):
    store = LocalStore(tmp_path / 'store'); store.root.mkdir()
    for key in ['../x', '/x', 'x//y', 'x/./y', 'x\\y']:
        with pytest.raises(ValueError): store.read(key)
    (store.root / 'escape').symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError): store.read('escape/file')


def test_gcs_uses_streaming_and_private_prefix(tmp_path):
    objects = {}
    class Blob:
        def __init__(self, key): self.key = key
        def open(self, mode, **kwargs): return BytesIO(objects[self.key])
        def upload_from_filename(self, path, **kwargs): objects[self.key] = Path(path).read_bytes()
    class Client:
        def bucket(self, name):
            assert name == 'private-test'; return self
        def blob(self, key): return Blob(key)
    store = GcsStore('private-test', 'blink3', Client())
    store.put_json('sample.json', {'hello': 'world'})
    assert store.json('sample.json') == {'hello': 'world'}
    assert list(objects) == ['blink3/sample.json']
