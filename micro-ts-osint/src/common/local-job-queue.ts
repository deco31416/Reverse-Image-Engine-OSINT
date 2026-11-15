import { ServiceUnavailableException } from '@nestjs/common';

type LocalState = { status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'; updatedAt: string };

export class LocalJobQueue {
  private readonly states = new Map<string, LocalState>();
  private readonly pending: Array<{ id: string; run: () => Promise<unknown> }> = [];
  private readonly active = new Set<string>();
  private stopped = false;

  constructor(private readonly concurrency: number, private readonly capacity = 100) {}

  assertCapacity() {
    if (this.stopped || this.pending.length >= this.capacity) throw new ServiceUnavailableException('Local job queue is full or stopped');
  }

  enqueue(id: string, run: () => Promise<unknown>) {
    const previous = this.states.get(id);
    if (previous && ['queued', 'processing'].includes(previous.status)) return previous;
    this.assertCapacity();
    this.set(id, 'queued');
    this.pending.push({ id, run });
    this.drain();
    return this.states.get(id)!;
  }

  get(id: string) { return this.states.get(id); }
  stats() { return { queued: this.pending.length, active: this.active.size, concurrency: this.concurrency }; }

  cancel(id: string) {
    const index = this.pending.findIndex((job) => job.id === id);
    if (index >= 0) this.pending.splice(index, 1);
    if (this.states.has(id)) this.set(id, 'cancelled');
  }

  close() {
    this.stopped = true;
    for (const job of this.pending) this.set(job.id, 'cancelled');
    this.pending.length = 0;
  }

  private set(id: string, status: LocalState['status']) {
    this.states.set(id, { status, updatedAt: new Date().toISOString() });
    if (this.states.size > 1000) {
      for (const [key, state] of this.states) {
        if (!['queued', 'processing'].includes(state.status)) { this.states.delete(key); break; }
      }
    }
  }

  private drain() {
    while (!this.stopped && this.active.size < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.active.add(job.id);
      this.set(job.id, 'processing');
      void Promise.resolve().then(job.run).then(
        () => { if (this.get(job.id)?.status !== 'cancelled') this.set(job.id, 'completed'); },
        () => { if (this.get(job.id)?.status !== 'cancelled') this.set(job.id, 'failed'); },
      ).finally(() => { this.active.delete(job.id); this.drain(); });
    }
  }
}
