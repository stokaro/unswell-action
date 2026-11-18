// The inputs that the action reads have to be the inputs that its manifest
// declares. A runner passes an undeclared input with a warning, so a manifest
// that loses one still works and nobody sees it; and a declared input that the
// entry point does not read does nothing. These two helpers let a test hold
// the two lists together.

// declaredInputs returns the names under the `inputs:` key of an action manifest.
export function declaredInputs(manifest) {
  const names = [];
  let inside = false;
  for (const line of manifest.split(/\r?\n/)) {
    if (/^\S/.test(line)) inside = line.trim() === 'inputs:';
    const name = inside && line.match(/^ {2}([A-Za-z][\w-]*):\s*$/);
    if (name) names.push(name[1]);
  }
  return names;
}

// readInputs returns the names of the inputs that a script reads from its environment.
export function readInputs(source) {
  const names = new Set();
  for (const match of source.matchAll(/process\.env(?:\.INPUT_([A-Z0-9_]+)|\['INPUT_([A-Z0-9_-]+)'\])/g)) {
    names.add((match[1] ?? match[2]).toLowerCase());
  }
  return [...names];
}

// undeclared and unread say how the two lists differ. A hyphen of a declared
// name is an underscore or a hyphen in the environment, so both spellings match.
export function inputDifferences(manifest, source) {
  const plain = (name) => name.replaceAll('-', '_');
  const declared = declaredInputs(manifest);
  const read = readInputs(source);
  return {
    undeclared: read.filter((name) => !declared.some((other) => plain(other) === plain(name))),
    unread: declared.filter((name) => !read.some((other) => plain(other) === plain(name))),
  };
}
