document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.getElementById('navToggle');
  const sidebar = document.getElementById('sidebar');
  if (navToggle && sidebar) {
    navToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    sidebar.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => sidebar.classList.remove('open'));
    });
  }

  /* ---------- Active nav highlighting ---------- */
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const sections = navLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const setActive = (id) => {
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
    });
  };

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });

    sections.forEach(sec => observer.observe(sec));
  }

  /* ---------- Back to top ---------- */
  const backToTop = document.getElementById('backToTop');
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('show', window.scrollY > 400);
  });
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- Copy to clipboard ---------- */
  const toast = document.getElementById('copyToast');
  let toastTimer = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      return true;
    }
  }

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      await copyText(text);
      btn.classList.add('copied');
      const original = btn.textContent;
      btn.textContent = '✓';
      showToast(`Скопировано: ${text}`);
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = original;
      }, 1200);
    });
  });

  /* ---------- Topic filters ---------- */
  const topicButtons = Array.from(document.querySelectorAll('.topic-btn'));
  const filterables = Array.from(document.querySelectorAll('[data-topics]'));

  topicButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      topicButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const topic = btn.getAttribute('data-topic');

      filterables.forEach(el => {
        if (topic === 'all') {
          el.classList.remove('hidden-by-filter');
          return;
        }
        const topics = (el.getAttribute('data-topics') || '').split(/\s+/).filter(Boolean);
        const matches = topics.includes(topic);
        el.classList.toggle('hidden-by-filter', topics.length > 0 && !matches);
      });

      if (topic !== 'all') {
        const firstVisible = filterables.find(el => !el.classList.contains('hidden-by-filter'));
        if (firstVisible) {
          firstVisible.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  /* ---------- Search ---------- */
  const searchInput = document.getElementById('searchInput');
  const searchCount = document.getElementById('searchCount');
  const contentRoot = document.getElementById('content');
  let currentHits = [];
  let currentIndex = -1;

  function clearHighlights() {
    contentRoot.querySelectorAll('mark.search-hit').forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function getTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('script, style')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function highlightQuery(query) {
    clearHighlights();
    currentHits = [];
    currentIndex = -1;

    if (!query || query.trim().length < 2) {
      searchCount.textContent = '';
      return;
    }

    const lowerQuery = query.toLowerCase();
    const textNodes = getTextNodes(contentRoot);

    textNodes.forEach(node => {
      const text = node.nodeValue;
      const lowerText = text.toLowerCase();
      let startIdx = 0;
      let idx;
      const fragments = [];
      let lastEnd = 0;
      let found = false;

      while ((idx = lowerText.indexOf(lowerQuery, startIdx)) !== -1) {
        found = true;
        fragments.push(document.createTextNode(text.slice(lastEnd, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(idx, idx + query.length);
        fragments.push(mark);
        lastEnd = idx + query.length;
        startIdx = lastEnd;
      }

      if (found) {
        fragments.push(document.createTextNode(text.slice(lastEnd)));
        const parent = node.parentNode;
        fragments.forEach(frag => parent.insertBefore(frag, node));
        parent.removeChild(node);
      }
    });

    currentHits = Array.from(contentRoot.querySelectorAll('mark.search-hit'));
    searchCount.textContent = currentHits.length
      ? `${currentHits.length} совпадени${currentHits.length === 1 ? 'е' : 'й'}`
      : 'нет совпадений';

    if (currentHits.length) {
      currentIndex = 0;
      focusHit(currentIndex);
    }
  }

  function focusHit(index) {
    currentHits.forEach(h => h.classList.remove('current'));
    const hit = currentHits[index];
    if (!hit) return;
    hit.classList.add('current');
    const details = hit.closest('details');
    if (details && !details.open) details.open = true;
    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  let searchDebounce = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const value = e.target.value;
    searchDebounce = setTimeout(() => highlightQuery(value), 200);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentHits.length) {
      e.preventDefault();
      currentIndex = (currentIndex + 1) % currentHits.length;
      focusHit(currentIndex);
    }
  });
});
