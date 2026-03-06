export function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function fromSlug(slug, items) {
  return items.find((i) => toSlug(i.matName) === slug) ?? null;
}
