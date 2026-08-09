"use client";

export interface PendingApproval {
  id: string;
  spoken: string;
  respond: (approved: boolean) => void;
}

let pending: PendingApproval | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPendingApproval(next: PendingApproval): void {
  if (pending?.id === next.id) return;
  pending = next;
  emit();
}

export function clearPendingApproval(id: string): void {
  if (pending?.id !== id) return;
  pending = null;
  emit();
}

export function getPendingApproval(): PendingApproval | null {
  return pending;
}

export function subscribePendingApproval(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPendingApprovalForTests(): void {
  pending = null;
  listeners.clear();
}
