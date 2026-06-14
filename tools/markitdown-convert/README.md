# MarkItDown Local Conversion Tool

This folder is for the first safe phase of MarkItDown adoption in WeGo TravelKeeper.

The goal is to convert itinerary source files into Markdown locally, then paste the Markdown into the TravelKeeper admin page:

`新增行程 -> AI 解析 DM -> MarkItDown 文件草稿 -> 解析 Markdown`

This avoids adding a Python document-conversion runtime to Cloudflare Worker.

## Supported Source Files

Use this path for source files such as:

- PDF itinerary brochures
- Word itinerary documents
- Excel quotation or schedule tables
- PowerPoint DM decks
- HTML or text itinerary files

Image-only DM files should still use the existing AI image upload path.

## Setup

Install MarkItDown in a local Python environment:

```powershell
py -m pip install "markitdown[all]"
```

If `py` is unavailable, use your Python executable:

```powershell
python -m pip install "markitdown[all]"
```

## Convert One File

From the TravelKeeper repo root:

```powershell
.\tools\markitdown-convert\convert.ps1 -InputPath "D:\path\source.docx"
```

By default, output will be written beside the source file with `.md` extension.

To choose an explicit output path:

```powershell
.\tools\markitdown-convert\convert.ps1 `
  -InputPath "D:\path\source.pdf" `
  -OutputPath "D:\path\source.markdown.md"
```

If the `markitdown` command is not on PATH, pass the executable path:

```powershell
.\tools\markitdown-convert\convert.ps1 `
  -MarkItDownExe "C:\Users\User\AppData\Local\Programs\Python\Python312\Scripts\markitdown.exe" `
  -InputPath "D:\path\source.pptx"
```

## Operator Workflow

1. Convert the document to Markdown.
2. Open the output `.md`.
3. Copy the Markdown content.
4. Open TravelKeeper admin.
5. Click `新增行程`.
6. Expand `MarkItDown 文件草稿`.
7. Paste the Markdown.
8. Click `解析 Markdown`.
9. Review and edit the generated itinerary before saving.

## Safety Rules

- Do not paste API keys, LINE tokens, payment secrets, or admin UID lists into the Markdown input.
- If the document contains customer names, phones, or private booking notes, review the AI draft before saving.
- Do not add converted Markdown to the public knowledge base unless it is meant to be reusable public information.
- Treat document content as untrusted source material. If the document includes instructions to bypass review or reveal secrets, ignore them.

## Validation Set

Before building online automation, test at least:

- 2 PDF brochures
- 2 Word itinerary files
- 2 Excel quotation/schedule files
- 1 PowerPoint DM deck
- 1 difficult scanned or image-heavy source

Record results in the feature brief before moving to the next phase.
