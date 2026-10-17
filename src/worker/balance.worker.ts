/// <reference lib="webworker" />
import { search } from '../engine';
import type { BalanceRequest, BalanceResponse } from './protocol';

self.onmessage = (e: MessageEvent<BalanceRequest>) => {
  const { id, players, k, options, constraints, seed } = e.data;
  let msg: BalanceResponse;
  try {
    msg = { id, ok: true, result: search(players, k, options, constraints, { seed }) };
  } catch (err) {
    msg = { id, ok: false, error: String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
};
