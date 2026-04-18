/**
 * multipart/form-data — thin adapter over Bun's native req.formData().
 *
 * We split the FormData entries into string fields and file-valued parts so
 * the files.upload v1 handler can grab the bytes without re-decoding the
 * body. Bun already parses multipart — this is just ergonomic extraction.
 */

export interface MultipartFilePart {
  fieldName: string
  filename: string
  mimetype: string
  bytes: Uint8Array
}

export interface ParsedMultipart {
  fields: Record<string, string>
  files: MultipartFilePart[]
}

export async function parseMultipart(req: Request): Promise<ParsedMultipart> {
  const form = await req.formData()
  const fields: Record<string, string> = {}
  const files: MultipartFilePart[] = []

  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields[name] = value
      continue
    }
    // `value` is a File/Blob — pull its bytes.
    const blob = value as Blob & { name?: string; type?: string }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    files.push({
      fieldName: name,
      filename: (blob as File).name || fields.filename || "upload.bin",
      mimetype: blob.type || "application/octet-stream",
      bytes,
    })
  }

  return { fields, files }
}

/**
 * Pick the file bytes for files.upload v1. Slack v1 looks for a `file=`
 * multipart field (or the first file-valued entry if not specified by name).
 */
export function pickUploadFile(parsed: ParsedMultipart): MultipartFilePart | undefined {
  return (
    parsed.files.find((f) => f.fieldName === "file") ?? parsed.files[0]
  )
}
