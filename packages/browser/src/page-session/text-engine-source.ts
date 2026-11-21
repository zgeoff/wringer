export const TEXT_ENGINE_NAME = 'wringer-text';

// The package has no DOM types, so the engine that runs in the page is source text. A selector body
// is JSON with `text` and `contains`: the innermost shown element whose whole shown text equals
// `text`, or with `contains`, every shown element whose shown text holds it.
export const TEXT_ENGINE_SOURCE = String.raw`(() => {
  const normalize = (text) => text.replace(/[\s​]+/g, ' ').trim();

  const childrenOf = (node) => {
    if (node.shadowRoot) {
      return Array.from(node.shadowRoot.childNodes);
    }

    if (node.localName === 'slot') {
      const assigned = node.assignedNodes({ flatten: true });

      return assigned.length > 0 ? assigned : Array.from(node.childNodes);
    }

    return Array.from(node.childNodes);
  };

  const makeReader = () => {
    const cache = new Map();

    const readRawText = (element) => {
      const cached = cache.get(element);

      if (cached !== undefined) {
        return cached;
      }

      const style = getComputedStyle(element);
      let text = '';

      if (style.display !== 'none' && style.contentVisibility !== 'hidden') {
        const showsText = style.visibility === 'visible';
        let inner = '';

        for (const child of childrenOf(element)) {
          if (child.nodeType === 3) {
            inner += showsText ? child.data : '';
          } else if (child.nodeType === 1) {
            inner += readRawText(child);
          }
        }

        if (element.localName === 'br') {
          inner = ' ';
        }

        const isInline =
          style.display === 'inline' || style.display === 'contents' || style.display === 'inline-block';

        text = isInline ? inner : ' ' + inner + ' ';
      }

      cache.set(element, text);

      return text;
    };

    return (element) => normalize(readRawText(element));
  };

  const isShown = (element) => {
    if (!element.checkVisibility({ visibilityProperty: true })) {
      return false;
    }

    const box = element.getBoundingClientRect();

    return box.width > 0 && box.height > 0;
  };

  const queryAll = (root, selector) => {
    const wanted = JSON.parse(selector);
    const text = normalize(wanted.text);
    const readText = makeReader();
    const found = [];

    // Answers whether the subtree holds an exact match, so that only the innermost element of
    // equal text counts.
    const visit = (node) => {
      let hasInner = false;

      for (const child of childrenOf(node)) {
        if (child.nodeType === 1 && visit(child)) {
          hasInner = true;
        }
      }

      if (node === root || node.nodeType !== 1 || !isShown(node)) {
        return hasInner;
      }

      const shown = readText(node);

      if (wanted.contains) {
        if (shown.includes(text)) {
          found.push(node);
        }

        return false;
      }

      if (shown === text && !hasInner) {
        found.push(node);
      }

      return hasInner || shown === text;
    };

    visit(root);

    return found.sort((first, second) =>
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  };

  return { queryAll, query: (root, selector) => queryAll(root, selector)[0] ?? null };
})()`;
