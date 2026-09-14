// A message namespace is one object per language with the *same shape*: plain strings for fixed
// copy, functions for anything that takes a count or a name. TypeScript infers the shape from the
// Chinese version (the original) and checks the English version against it, so a key added to one
// language and forgotten in the other fails `tsc`, not the user.
export type Bilingual<T> = { readonly zh: T; readonly en: T };

export function defineMessages<T extends object>(m: { zh: T; en: NoInfer<T> }): Bilingual<T> {
  return m;
}
