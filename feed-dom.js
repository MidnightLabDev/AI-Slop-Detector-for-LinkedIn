(() => {
  // Keep old layouts as fallbacks. Do not use changing, generated class names.
  const ROOT = [
    '[data-testid="mainFeed"] [role="listitem"]',
    '[data-view-name="feed-full-update"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    '[data-urn^="urn:li:activity:"]',
    '[data-id^="urn:li:activity:"]'
  ].join(',');
  const TEXT = [
    '[data-testid="expandable-text-box"]',
    '[data-view-name="feed-commentary"]',
    '.feed-shared-update-v2__description',
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-text',
    '[data-test-id="main-feed-activity-card__commentary"]'
  ];
  const EXCLUDE = [
    'aside', 'nav', '[role="complementary"]', '[role="dialog"]',
    '[contenteditable="true"]', '[role="textbox"]',
    '.comments-comment-item', '.comments-comment-entity',
    '.comments-comments-list', '.comments-comment-box',
    '[data-testid^="comment"]', '[data-view-name^="comment"]',
    '[data-view-name="feed-comment"]', '.msg-overlay-list-bubble',
    '[data-testid*="messaging"]', '[data-view-name*="messaging"]',
    '.feed-shared-article', '.update-components-reshared-content',
    '[data-view-name="feed-reshared-content"]',
    '[data-testid="reshared-content"]', '.ai-slop-detector-host'
  ].join(',');

  function excluded(node) {
    if (node.closest(EXCLUDE)) return true;
    // A comment can itself be a list item with expandable text.
    const feed = node.closest('[data-testid="mainFeed"]');
    const item = node.closest('[role="listitem"]');
    return !!(feed && item && feed.contains(item.parentElement?.closest('[role="listitem"]')));
  }

  function textNode(root) {
    for (const selector of TEXT) {
      for (const node of root.querySelectorAll(selector)) {
        if (!excluded(node) && node.closest(ROOT) === root) return node;
      }
    }
    return null;
  }

  function discover(doc) {
    const cards = [...doc.querySelectorAll(ROOT)].filter(root => !excluded(root));
    const posts = [];
    for (const root of cards) {
      const node = textNode(root);
      if (node) posts.push({root, node});
    }
    return {
      posts,
      cards: cards.length,
      layout: doc.querySelector('[data-testid="mainFeed"]') ? 'Current feed' :
        doc.querySelector('[data-view-name="feed-full-update"]') ? 'Feed cards' :
        cards.length ? 'Classic feed' : 'Waiting for posts'
    };
  }

  function read(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll(EXCLUDE + ',.slop-stamp-host,button,script,style,[hidden],[aria-hidden="true"],.visually-hidden,.sr-only,.feed-shared-inline-show-more-text__see-more-less-toggle').forEach(n => n.remove());
    copy.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
    copy.querySelectorAll('p,div,li').forEach(n => n.append('\n'));
    return copy.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function visible(node) {
    if (!node.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const view = node.ownerDocument.defaultView;
    const rect = node.getBoundingClientRect();
    const height = view.innerHeight || node.ownerDocument.documentElement.clientHeight;
    const width = view.innerWidth || node.ownerDocument.documentElement.clientWidth;
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
  }

  globalThis.SlopFeed = {discover, read, visible};
})();
