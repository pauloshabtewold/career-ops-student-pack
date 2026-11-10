// Stub signatures for the alert plan; the implementation replaces every body.
export function alertPlan({ config, archetypes, merged }) {
  void [config, archetypes, merged];
  return { items: [], upcoming: [] };
}

export function formatPlan({ items, upcoming }) {
  void [items, upcoming];
  return [];
}
