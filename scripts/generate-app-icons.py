#!/usr/bin/env python3
"""Export the approved Icon Composer source for the web (macOS + Xcode 27)."""
import copy
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'ios/ActivityMap/ActivityMap/AppIcon.icon'
PUBLIC = ROOT / 'public'
NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])


def run(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True).strip()


def svg(body, view_box=(0, 0, 1024, 1024)):
    x, y, width, height = view_box
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="{x} {y} {width} {height}">\n' + body + '\n</svg>\n')


# The map panels span x 206-819 and y 222-777 of the icon canvas. Cropping the
# transparent mark to them (with a little room for antialiasing) lets it fill
# its box in small places such as the 24px web header.
MARK_VIEW_BOX = (200, 216, 625, 565)


def artwork(filename):
    return ''.join(ET.tostring(child, encoding='unicode')
                   for child in ET.parse(SOURCE / 'Assets' / filename).getroot())


def main():
    for executable in ('magick', 'rsvg-convert', 'xcode-select'):
        if not shutil.which(executable):
            raise SystemExit(f'Missing {executable}; see docs/app-icon.md.')
    developer = Path(run('xcode-select', '-p'))
    ictool = developer.parent / 'Applications/Icon Composer.app/Contents/Executables/ictool'
    srgb = Path('/System/Library/ColorSync/Profiles/sRGB Profile.icc')
    document = json.loads((SOURCE / 'icon.json').read_text())
    color = document['fill']['automatic-gradient'].split(':', 1)[1].split(',')
    brand = '#' + ''.join(f'{round(float(channel) * 255):02x}' for channel in color[:3])
    map_art = artwork('Folded-Map.svg')
    route_art = artwork('Blue-Route.svg')

    with tempfile.TemporaryDirectory(prefix='activitymap-icons-') as directory:
        temporary = Path(directory)

        def render_native(source, destination):
            run(ictool, source, '--export-image', '--output-file', destination,
                '--platform', 'iOS', '--rendition', 'Default', '--width', '1024',
                '--height', '1024', '--scale', '1', '--design-generation', '27')
            # Icon Composer exports Display P3. Convert before stripping metadata.
            run('magick', destination, '-profile', srgb, '-depth', '8', '-strip', destination)

        native = temporary / 'native.png'
        render_native(SOURCE, native)
        shutil.copyfile(native, PUBLIC / 'app-icon.png')

        # Capture the automatic gradient with no foreground artwork. The SVG uses
        # sampled interior stops; Apple's dynamic enclosure lighting stays native.
        background_icon = temporary / 'background.icon'
        background_icon.mkdir()
        background_document = copy.deepcopy(document)
        background_document['groups'] = []
        (background_icon / 'icon.json').write_text(json.dumps(background_document))
        background = temporary / 'background.png'
        render_native(background_icon, background)
        stops = []
        for y in (32, 128, 256, 512, 768, 896, 992):
            sample = run('magick', background, '-format', f'%[hex:p{{512,{y}}}]', 'info:')[:6]
            stops.append(f'<stop offset="{y / 1024:.5f}" stop-color="#{sample}"/>')
        definitions = ('<defs><linearGradient id="background" x1="0" y1="0" x2="0" y2="1">'
                       + ''.join(stops) + '</linearGradient></defs>')
        foreground = map_art + route_art
        rounded = svg(definitions + '<rect width="1024" height="1024" rx="234" fill="url(#background)"/>' + foreground)
        square = svg(definitions + '<rect width="1024" height="1024" fill="url(#background)"/>' + foreground)
        maskable = svg(definitions + '<rect width="1024" height="1024" fill="url(#background)"/>'
                       + '<g transform="translate(512 512) scale(.92) translate(-512 -512)">' + foreground + '</g>')
        (PUBLIC / 'favicon.svg').write_text(rounded)
        # Transparent mark for coloured surfaces such as the web header: the same
        # panels and route, without the background tile.
        (PUBLIC / 'app-mark.svg').write_text(svg(foreground, MARK_VIEW_BOX))
        (PUBLIC / 'apple-touch-icon.svg').write_text(square)
        square_source = temporary / 'square.svg'
        square_source.write_text(square)
        maskable_source = temporary / 'maskable.svg'
        maskable_source.write_text(maskable)

        def render_svg(source, destination, size):
            run('rsvg-convert', source, '-w', size, '-h', size, '-o', destination)
            run('magick', destination, '-depth', '8', '-strip', destination)

        for name in ('apple-icon-180.png', 'apple-touch-icon.png'):
            render_svg(square_source, PUBLIC / name, 180)
        for size in (192, 512):
            run('magick', native, '-resize', f'{size}x{size}', '-strip', PUBLIC / f'android-chrome-{size}x{size}.png')
            render_svg(maskable_source, PUBLIC / f'manifest-icon-{size}.maskable.png', size)
        run('magick', native, '-define', 'icon:auto-resize=48,32,16', PUBLIC / 'favicon.ico')

        # Safari pinned tabs require an alpha silhouette. Cut the route out of
        # the map so both elements remain recognizable in a single system tint.
        mask_map = ET.parse(SOURCE / 'Assets/Folded-Map.svg').getroot()[0]
        mask_map.set('fill', '#ffffff')
        route_mask = route_art.replace(brand.upper(), '#000000').replace(brand.lower(), '#000000')
        mask = ('<defs><mask id="symbol"><rect width="1024" height="1024" fill="black"/>'
                + ET.tostring(mask_map, encoding='unicode') + route_mask + '</mask></defs>'
                + '<rect width="1024" height="1024" fill="black" mask="url(#symbol)"/>')
        (PUBLIC / 'safari-pinned-tab.svg').write_text(svg(mask))

        for path in sorted(PUBLIC.glob('mstile-*.png')):
            width, height = map(int, run('magick', 'identify', '-format', '%w %h', path).split())
            size = round(min(width, height) * .72)
            run('magick', native, '-resize', f'{size}x{size}', '-background', brand,
                '-gravity', 'center', '-extent', f'{width}x{height}', '-alpha', 'remove', '-strip', path)
        for path in sorted(PUBLIC.glob('apple-splash-*.jpg')):
            width, height = map(int, re.search(r'(\d+)-(\d+)\.jpg$', path.name).groups())
            size = round(min(width, height) * .6)
            run('magick', native, '-resize', f'{size}x{size}', '-background', brand,
                '-gravity', 'center', '-extent', f'{width}x{height}', '-alpha', 'remove',
                '-strip', '-quality', '90', path)
    print('Exported iOS source to web SVG (including the transparent app mark), PNG, ICO, maskable icons, tiles, and launch images.')


if __name__ == '__main__':
    main()
