export interface ProcessPayload {
  exe: string | null;
  pid: number;
  parentPid?: number | null;
  name: string;
  environ?: Record<string, string> | null;
  cwd?: string | null;
}
