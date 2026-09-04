#!/usr/bin/env python3
"""Validate the English Developer Docs package and build a full-text index."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

import yaml

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'web/content/developer-docs'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true', help='Regenerate SVGs using mmdc')
    parser.add_argument('--package-example', action='store_true', help='Regenerate deterministic sample ZIP')
    args = parser.parse_args()
    if args.package_example:
        with zipfile.ZipFile(ROOT / 'assets/shadow-demo.zip', 'w') as archive:
            for name in ['README.md', 'demo.py', 'recover.py', 'verify.py', 'requirements.txt']:
                info = zipfile.ZipInfo(name, (2026, 9, 4, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, (ROOT / 'examples/shadow-demo' / name).read_bytes())
    index = yaml.safe_load((ROOT / 'index.en.yaml').read_text())
    with zipfile.ZipFile(ROOT / 'assets/shadow-demo.zip') as archive:
        expected = ['README.md', 'demo.py', 'recover.py', 'verify.py', 'requirements.txt']
        assert sorted(archive.namelist()) == sorted(expected), 'Unexpected sample archive files'
        for name in expected:
            assert archive.read(name) == (ROOT / 'examples/shadow-demo' / name).read_bytes(), f'Stale sample archive: {name}'
    records = []
    diagram_count = 0
    for source in sorted((ROOT / 'assets').glob('*.mmd')):
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        output = source.with_suffix('.svg')
        if args.render:
            with tempfile.TemporaryDirectory(prefix='developer-docs-') as directory:
                config = Path(directory) / 'mermaid.json'
                config.write_text(json.dumps({'theme': 'neutral', 'securityLevel': 'strict',
                    'sequence': {'wrap': True, 'useMaxWidth': False, 'actorMargin': 35,
                                 'messageMargin': 28, 'width': 160},
                    'flowchart': {'useMaxWidth': False}}))
                subprocess.run(['mmdc', '-i', str(source), '-o', str(output),
                    '-c', str(config), '-b', 'white'], check=True)
            output.write_text(output.read_text() + f'\n<!-- source-sha256: {digest} -->\n')
        assert output.exists(), f'Missing SVG: {output}; run with --render'
        ET.fromstring(output.read_text())
        assert f'source-sha256: {digest}' in output.read_text(), f'Stale diagram: {source}'
        diagram_count += 1
    slugs = [section['slug'] for section in index['sections']]
    assert len(slugs) == len(set(slugs)), 'Duplicate navigation slug'
    assert {section['source'] for section in index['sections']} == {
        p.name for p in ROOT.glob('*.en.md')}, 'Navigation and page inventory differ'
    for section in index['sections']:
        source = ROOT / section['source']
        raw = source.read_text()
        _, front, body = raw.split('---', 2)
        meta = yaml.safe_load(front)
        for field in ('title', 'description', 'category', 'keywords', 'language',
                      'applies_to', 'last_verified', 'verification'):
            assert meta.get(field), f'{source}: missing {field}'
        assert meta['language'] == 'en'
        assert meta['title'] == section['title']
        assert meta['category'] == section['category'], f'{source}: navigation category differs from frontmatter'
        headings = []
        for language, code in re.findall(r'^```([^\n]*)\n(.*?)^```', body, re.M | re.S):
            if language == 'json':
                json.loads(code)
            if language == 'bash':
                subprocess.run(['bash', '-n'], input=code, text=True, check=True)
        for label, link in re.findall(r'!?\[([^\]]*)\]\(([^)]+)\)', body):
            if '://' not in link and not link.startswith(('#', '/console/')):
                assert (source.parent / link.split('#')[0]).exists(), f'{source}: broken link {link}'
        for title in re.findall(r'^#{1,6} (.+)$', body, re.M):
            anchor = re.sub(r'[^\w -]', '', title.lower()).replace(' ', '-')
            headings.append({'title': title, 'anchor': anchor})
        # Source-relative identifiers: the future website owns public URL mapping.
        text = re.sub(r'!?\[([^\]]+)\]\([^)]+\)', r'\1', body)
        text = text.replace('```bash', '').replace('```json', '').replace('```text', '').replace('```', '')
        records.append({**section, 'language': 'en', 'headings': headings,
                        'text': text.strip(), 'applies_to': meta['applies_to'],
                        'last_verified': str(meta['last_verified']),
                        'verification': meta['verification']})
    output = REPO / 'dist/developer-docs/search.en.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'title': index['title'], 'pages': records}, indent=2) + '\n')
    print(f'PASS: {len(records)} pages, {diagram_count} SVG diagrams; metadata, links, JSON and Bash syntax')
    print(f'Full-text index: {output.relative_to(REPO)}')


if __name__ == '__main__':
    main()
