import type { AttachmentWithUrl } from "@/lib/notices/queries";

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fileName(storagePath: string): string {
  return storagePath.split("/").pop() ?? storagePath;
}

/** Signed URL은 발급 시점에만 유효하다(10분) — 매번 서버에서 새로 만들어 전달한다(§13). */
export function AttachmentList({ attachments }: { attachments: AttachmentWithUrl[] }) {
  if (attachments.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {attachments.map((a) => (
        <li key={a.id}>
          <a
            href={a.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-text hover:bg-bg"
          >
            <span className="truncate">📎 {fileName(a.storage_path)}</span>
            <span className="shrink-0 text-xs text-text-3">{formatFileSize(a.size_bytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
