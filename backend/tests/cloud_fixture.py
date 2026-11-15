"""Local browser fixture: generated synthetic FITS only, temporary store, no network archives."""
import argparse
from pathlib import Path
import tempfile

import uvicorn
from conftest import write_frame
from spherex.cloud_job import prepare
from spherex.storage import LocalStore
from cloud_app import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8810)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='blink-cloud-fixture-') as tmp:
        root = Path(tmp)
        write = write_frame.__wrapped__(root)
        paths = [write(ra=150, dec=20, mjd=60800+i*40, detector=2, stars=[(150, 20, 500)],
                       header_extra={'COMMENT': 'SYNTHETIC TEST FILE'})[0] for i in range(3)]
        plan = {'version': 1, 'sequenceId': 'fixture-d2', 'collection': 'synthetic-test',
                'query': {'ra': 150, 'dec': 20, 'fov': 5, 'det': 'D2'},
                'maxFileBytes': 1024**2, 'maxTotalBytes': 4*1024**2,
                'termsChecked': True, 'acknowledgement': 'Generated synthetic browser fixture, not observations.',
                'files': [{'obsId': str(i), 'mjd': 60800+i*40, 'name': f'input-{i}.fits',
                           'url': f'https://irsa.ipac.caltech.edu/test/{i}.fits'} for i in range(3)]}
        store = LocalStore(root/'store')
        key, _ = prepare(plan, paths, store, fixture=True)
        app = create_app(store, [{'sequenceId': 'fixture-d2', 'manifest': key, 'termsChecked': True}],
                         pixels=True, public_base='https://blink-api.example', origins=['https://blink-ui.example'])
        uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
