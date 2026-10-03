// Generic public example, not a user strategy. All operands derive from the same frame.
export const swingPreset = {
  version: 1,
  root: { type: 'group', op: 'AND', children: [
    { type: 'condition', id: 'trend', timeframe: 'D', left: { kind: 'ma', field: 'close', window: 20 }, op: 'gt', right: { kind: 'ma', field: 'close', window: 60 } },
    { type: 'condition', id: 'breakout', timeframe: 'D', left: { kind: 'field', field: 'close' }, op: 'gt', right: { kind: 'prior_high', window: 20 } },
    { type: 'condition', id: 'volume', timeframe: 'D', left: { kind: 'volume_ratio', window: 5 }, op: 'gte', right: { kind: 'constant', value: 1.2 } }
  ] }
};
