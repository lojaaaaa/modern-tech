#!/usr/bin/env python3
"""Generate an Office compatibility corpus, then inspect editor-saved OOXML files.

The inspector runs against original files or downloaded callback artifacts. It does
not prove browser convergence, cursor visibility, or general Office compatibility.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent


def normalized_archive(path):
    """Stable ZIP metadata permits fixture hashes to be compared between runs."""
    with ZipFile(path) as source:
        members = [(name, source.read(name)) for name in sorted(source.namelist())]
    with ZipFile(path, "w", ZIP_DEFLATED) as target:
        for name, content in members:
            if name == "docProps/core.xml":
                content = re.sub(rb"(<dcterms:modified[^>]*>)[^<]+", rb"\g<1>2026-11-07T00:00:00Z", content)
            info = ZipInfo(name, (2026, 11, 7, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            target.writestr(info, content)


def generate(directory):
    from docx import Document
    from docx.shared import Pt
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from pptx import Presentation
    from pptx.util import Inches

    directory.mkdir(parents=True, exist_ok=True)
    document = Document()
    document.core_properties.created = datetime(2026, 11, 7, tzinfo=timezone.utc)
    document.core_properties.modified = datetime(2026, 11, 7, tzinfo=timezone.utc)
    document.add_heading("Совместный договор", 0)
    paragraph = document.add_paragraph("Исходный абзац — Unicode: ё, Ω, 文. ")
    paragraph.add_run("Важное условие").bold = True
    document.add_paragraph("Повторяющаяся цитата.")
    document.add_paragraph("Повторяющаяся цитата.")
    table = document.add_table(rows=3, cols=2)
    table.style = 'Table Grid'
    for row, values in zip(table.rows, (("Сторона", "Срок"), ("Алиса", "10 дней"), ("Борис", "20 дней"))):
        for cell, value in zip(row.cells, values):
            cell.text = value
    document.add_paragraph("Конец исходного документа.")
    document.styles['Normal'].font.name = 'Arial'
    document.styles['Normal'].font.size = Pt(11)
    document.save(directory / 'sample.docx')

    workbook = Workbook()
    workbook.properties.created = datetime(2026, 11, 7, tzinfo=timezone.utc)
    workbook.properties.modified = datetime(2026, 11, 7, tzinfo=timezone.utc)
    sheet = workbook.active
    sheet.title = 'Расчёт'
    sheet.append(['Бюджет проекта', 'Значение', 'Сумма'])
    sheet.append(['Курс', 1.25, '=B2*2'])
    sheet.append([10, 20, '=SUM(A3:B3)'])
    for cell in sheet[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='2455A0')
    sheet.column_dimensions['A'].width = 28
    sheet.column_dimensions['B'].width = 18
    sheet.column_dimensions['C'].width = 18
    sheet.freeze_panes = 'A2'
    sheet['B2'].number_format = '0.00'
    workbook.create_sheet('Справочник')['A1'] = 'Данные второго листа — ё Ω 文'
    workbook.save(directory / 'sample.xlsx')

    presentation = Presentation()
    presentation.core_properties.created = datetime(2026, 11, 7, tzinfo=timezone.utc)
    presentation.core_properties.modified = datetime(2026, 11, 7, tzinfo=timezone.utc)
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    for title, body in (('План проекта', 'Первая контрольная точка — ё Ω 文'), ('Результаты', 'Вторая контрольная точка')):
        slide = presentation.slides.add_slide(presentation.slide_layouts[1])
        slide.shapes.title.text = title
        slide.placeholders[1].text = body
    presentation.save(directory / 'sample.pptx')
    for path in sorted(directory.glob('sample.*')):
        normalized_archive(path)
    manifest = {path.name: {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in sorted(directory.glob('sample.*'))}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def inspect_file(path):
    if path.suffix == '.docx':
        from docx import Document
        document = Document(path)
        return {'paragraphs': [p.text for p in document.paragraphs], 'tables': [[[cell.text for cell in row.cells] for row in table.rows] for table in document.tables], 'bold': [run.text for p in document.paragraphs for run in p.runs if run.bold]}
    if path.suffix == '.xlsx':
        from openpyxl import load_workbook
        workbook = load_workbook(path, data_only=False)
        cached = load_workbook(path, data_only=True)
        return {'sheets': workbook.sheetnames, 'cells': {sheet.title: {cell.coordinate: cell.value for row in sheet for cell in row if cell.value is not None} for sheet in workbook}, 'formula_result': cached['Расчёт']['C3'].value, 'header_bold': workbook['Расчёт']['A1'].font.bold, 'freeze_panes': workbook['Расчёт'].freeze_panes}
    if path.suffix == '.pptx':
        from pptx import Presentation
        presentation = Presentation(path)
        return {'slides': [[shape.text for shape in slide.shapes if shape.has_text_frame] for slide in presentation.slides]}
    raise ValueError('Unsupported fixture')


def verify(directory, edited):
    reports = {}
    for extension in ('docx', 'xlsx', 'pptx'):
        path = directory / f'sample.{extension}'
        reports[extension] = inspect_file(path)
        reports[extension]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    word = reports['docx']
    assert word['paragraphs'][0].startswith('Совместный договор'), 'DOCX title lost'
    assert 'Важное условие' in word['bold'], 'DOCX bold formatting lost'
    assert word['tables'] == [[['Сторона', 'Срок'], ['Алиса', '10 дней'], ['Борис', '20 дней']]], 'DOCX table lost'
    assert sum('Повторяющаяся цитата.' in paragraph for paragraph in word['paragraphs']) == 2, 'DOCX duplicate paragraph structure lost'
    sheet = reports['xlsx']
    assert sheet['sheets'] == ['Расчёт', 'Справочник'], 'XLSX sheet order changed'
    assert sheet['cells']['Расчёт']['C3'] == '=SUM(A3:B3)', 'XLSX formula lost'
    assert sheet['cells']['Расчёт']['C2'] == '=B2*2', 'XLSX secondary formula lost'
    assert sheet['header_bold'] is True and sheet['freeze_panes'] == 'A2', 'XLSX formatting lost'
    slides = reports['pptx']['slides']
    assert len(slides) == 2 and slides[0][0].startswith('План проекта') and slides[1][0].startswith('Результаты'), 'PPTX slide count/order lost'
    if edited:
        text = '\n'.join(word['paragraphs'])
        assert 'ALICE_DOCX' in text and 'BOB_DOCX' in text, 'DOCX collaborator edits missing'
        assert sheet['cells']['Расчёт']['A3'] == 17 and sheet['cells']['Расчёт']['B3'] == 25, 'XLSX collaborator edits missing'
        assert sheet['formula_result'] == 42, 'XLSX calculation not preserved'
        text = '\n'.join(text for slide in slides for text in slide)
        assert 'ALICE_PPTX' in text and 'BOB_PPTX' in text, 'PPTX collaborator edits missing'
    else:
        assert sheet['cells']['Расчёт']['A3'] == 10 and sheet['cells']['Расчёт']['B3'] == 20, 'Unexpected baseline values'
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generate', 'inspect', 'verify'))
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT / 'corpus')
    parser.add_argument('--edited', action='store_true', help='Require both participants edits and recalculated XLSX')
    args = parser.parse_args()
    if args.command == 'generate':
        result = generate(args.directory)
    elif args.command == 'verify':
        result = verify(args.directory, args.edited)
    else:
        result = {path.name: inspect_file(path) for path in sorted(args.directory.glob('sample.*')) if path.suffix in ('.docx', '.xlsx', '.pptx')}
    print(json.dumps(result, ensure_ascii=False, indent=2))
