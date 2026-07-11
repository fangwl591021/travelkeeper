from pathlib import Path

changed = 0
for path in Path('tests').glob('*.test.mjs'):
    text = path.read_text(encoding='utf-8')
    updated = text.replace("X-TravelKeeper-Tenant-Isolation', 'phase10'", "X-TravelKeeper-Tenant-Isolation', 'phase11'")
    if updated != text:
        path.write_text(updated, encoding='utf-8')
        changed += 1
print(f'Updated phase header assertions in {changed} test files')
