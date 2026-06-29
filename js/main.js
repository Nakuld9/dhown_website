// ── Nav scroll effect ──────────────────────────────
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ── Mobile hamburger ───────────────────────────────
const hamburger = document.querySelector('.nav-hamburger');
const mobileMenu = document.querySelector('.nav-mobile');
hamburger?.addEventListener('click', () => {
  mobileMenu?.classList.toggle('open');
});
document.querySelectorAll('.nav-mobile .nav-link, .nav-mobile .btn').forEach(el => {
  el.addEventListener('click', () => mobileMenu?.classList.remove('open'));
});

// ── Scroll reveal ──────────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('[data-reveal]').forEach((el, i) => {
  el.style.transitionDelay = (i % 4) * 0.08 + 's';
  observer.observe(el);
});

// ── Active nav link ────────────────────────────────
const path = window.location.pathname.replace(/\/$/, '').split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link, .nav-mobile .nav-link').forEach(link => {
  const href = link.getAttribute('href') || '';
  if (href.includes(path) || (path === '' && href.includes('index'))) {
    link.classList.add('active');
  }
});

// ── Netlify form AJAX ──────────────────────────────
const form = document.getElementById('enquiry-form');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const data = new FormData(form);
    await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
    form.reset();
    const success = document.getElementById('form-success');
    if (success) { success.style.display = 'block'; }
    btn.textContent = 'Sent!';
  } catch {
    btn.textContent = 'Send Enquiry';
    btn.disabled = false;
    alert('Something went wrong. Please email us directly.');
  }
});

// ── Counter animation ──────────────────────────────
function animateCounter(el, target, suffix = '') {
  let start = 0;
  const duration = 1800;
  const step = timestamp => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(ease * target) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const el = e.target;
      animateCounter(el, parseInt(el.dataset.count), el.dataset.suffix || '');
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

// ── Fabric detail modal ────────────────────────────
const PRODUCTS = {
  SJ: {
    name: 'Single Jersey',
    subtitle: 'Single Needle Bed Construction',
    desc: 'Knitted on a single set of needles, each course creates a smooth face stitch and a textured loop on the reverse. The most widely produced knitted fabric — lightweight, soft, and easy to cut and sew.',
    gsm: '120 – 220 GSM',
    gauge: '20 – 36 GG',
    yarn: 'Cotton, Polyester, CVC, PC, Bamboo, Spandex',
    construction: 'Single needle bed, one yarn feed per course',
    properties: ['Lightweight & breathable', 'Excellent drape', 'Soft hand feel', 'Easy to print & dye', 'Slight curl at raw edges'],
    applications: ['T-Shirts', 'Innerwear', 'Casual Wear', 'Basics', 'Sportswear Linings'],
    bgClass: 'fabric-sj-bg',
  },
  RB: {
    name: 'Rib Fabric',
    subtitle: 'Double Needle Bed Construction',
    desc: 'Produced on two opposing needle beds, alternating knit and purl columns (1×1, 2×2, 2×1 variants) create a fabric with superior horizontal stretch and strong shape recovery — edges lie flat without curling.',
    gsm: '180 – 320 GSM',
    gauge: '14 – 24 GG',
    yarn: 'Cotton, CVC, Polyester, Spandex blends',
    construction: 'Double needle bed, alternating knit-purl columns',
    properties: ['High horizontal elasticity', 'Strong shape recovery', 'Flat, curl-free edges', 'Good lengthwise stability', 'Available 1×1, 2×2, 2×1'],
    applications: ['Sportswear', 'Cuffs & Collars', 'Active Wear', 'Waistbands', 'Neckbands'],
    bgClass: 'fabric-rb-bg',
  },
  IL: {
    name: 'Interlock',
    subtitle: 'Double-Faced Rib Knit',
    desc: 'Two rib courses interlock back-to-back, producing identical smooth surfaces on both faces. Heavier and more dimensionally stable than Single Jersey, with minimal curling and excellent drape.',
    gsm: '180 – 280 GSM',
    gauge: '20 – 28 GG',
    yarn: 'Cotton, CVC, Bamboo, Lyocell blends',
    construction: 'Two interlocked rib layers, smooth on both faces',
    properties: ['Smooth face on both sides', 'More stable than Single Jersey', 'Minimal curling', 'Heavier hand', 'Good body and drape'],
    applications: ['Polo Shirts', 'Premium Innerwear', 'Babywear', 'Loungewear', 'Premium T-Shirts'],
    bgClass: 'fabric-il-bg',
  },
  TV: {
    name: 'Terry Velour',
    subtitle: 'Loop-Pile Knit with Velour Finish',
    desc: 'A ground yarn forms the jersey structure while a pile yarn creates dense loops. The loops are sheared to create Velour — a plush, velvety surface with exceptional softness and high moisture absorption.',
    gsm: '280 – 500 GSM',
    gauge: '16 – 24 GG',
    yarn: 'Cotton, Bamboo Cotton, Microfibre, CVC',
    construction: 'Ground + pile yarn, sheared pile (velour) or unsheared (terry)',
    properties: ['Superior moisture absorption', 'Plush, velvety surface', 'Dense pile structure', 'Excellent softness', 'High durability'],
    applications: ['Bathrobes', 'Towelling', 'Premium Sportswear', 'Luxury Loungewear', 'Spa Products'],
    bgClass: 'fabric-tv-bg',
  },
  SL: {
    name: 'Single Lacoste',
    subtitle: 'Single-Layer Piqué Construction',
    desc: 'A two-feed piqué construction creating characteristic mesh eyelet holes within a jersey ground. The resulting fabric is breathable, more structured than plain Single Jersey, and retains its shape well.',
    gsm: '180 – 240 GSM',
    gauge: '18 – 24 GG',
    yarn: 'Cotton, CVC, Polyester, PC blends',
    construction: 'Two-feed piqué with eyelet mesh, single needle bed',
    properties: ['Breathable mesh structure', 'More structured than SJ', 'Good shape retention', 'Moisture managing', 'Clean appearance'],
    applications: ['Polo Shirts', 'Corporate Wear', 'Sportswear', 'School Uniforms', 'Performance Tops'],
    bgClass: 'fabric-lacoste-bg',
  },
  DL: {
    name: 'Double Lacoste',
    subtitle: 'Double-Layer Piqué Construction',
    desc: 'A three-feed piqué construction producing a denser, heavier fabric than Single Lacoste. The additional yarn feed closes the mesh slightly, creating a richer texture and more substantial hand for premium applications.',
    gsm: '220 – 320 GSM',
    gauge: '18 – 24 GG',
    yarn: 'Cotton, CVC, PC blends',
    construction: 'Three-feed piqué, denser two-layer structure',
    properties: ['Heavier than Single Lacoste', 'Richer surface texture', 'Premium fabric hand', 'Excellent shape retention', 'Durable construction'],
    applications: ['Premium Polo Shirts', 'Formal T-Shirts', 'Corporate Uniforms', 'Export Quality Tops', 'High-End Sportswear'],
    bgClass: 'fabric-dl-bg',
  },
  PP: {
    name: 'Polo Pique',
    subtitle: 'Classic Piqué Knit',
    desc: 'The definitive polo fabric — a piqué construction with a raised, textured surface created by tuck and knit stitch combinations. Structured, breathable, and moisture-managing with a clean professional appearance.',
    gsm: '180 – 260 GSM',
    gauge: '18 – 28 GG',
    yarn: 'Cotton, Polyester, CVC, PC blends',
    construction: 'Piqué with raised woven-like surface, tuck stitch pattern',
    properties: ['Textured raised surface', 'Breathable & moisture-managing', 'Structured and firm', 'Professional appearance', 'Good colour retention'],
    applications: ['Polo Shirts', 'Performance Tops', 'Corporate Wear', 'Golf Shirts', 'Premium Sportswear'],
    bgClass: 'fabric-lacoste-bg',
  },
  '3TF': {
    name: 'Three Thread Fleece',
    subtitle: 'Three-Yarn Thermal Knit',
    desc: 'Three separate yarns serve distinct roles: the face thread creates a smooth jersey exterior, the stitch thread locks the structure, and the pile thread forms a soft, brushed interior. The industry standard for heavyweight hoodies and sweatshirts.',
    gsm: '260 – 450 GSM',
    gauge: '14 – 20 GG',
    yarn: 'Cotton face / Polyester or Cotton pile / CVC stitch',
    construction: 'Three-yarn: face thread + stitch thread + pile thread',
    properties: ['Smooth jersey face', 'Soft brushed pile interior', 'Superior thermal insulation', 'Heavyweight body', 'Holds shape after washing'],
    applications: ['Hoodies', 'Sweatshirts', 'Winter Wear', 'Jackets', 'Workwear'],
    bgClass: 'fabric-fleece-bg',
  },
  FT: {
    name: 'French Terry / Loop Terry',
    subtitle: 'Smooth Face, Looped Reverse',
    desc: 'A jersey construction where a second yarn creates uncut loops on the reverse side. The face is smooth and printable; the back loops provide warmth and moisture absorption — making it a lighter, more breathable alternative to three-thread fleece.',
    gsm: '200 – 320 GSM',
    gauge: '16 – 24 GG',
    yarn: 'Cotton, CVC, Polyester, Bamboo blends',
    construction: 'Jersey face with uncut loop yarn on reverse',
    properties: ['Smooth printable face', 'Uncut loops on reverse', 'Lightweight warmth', 'Good moisture absorption', 'Breathable drape'],
    applications: ['Athleisure', 'Loungewear', 'Sweatshirts', 'Casual Jackets', 'Active Wear'],
    bgClass: 'fabric-ft-bg',
  },
  RF: {
    name: 'Russian Fleece',
    subtitle: 'Heavy-Duty Brushed Fleece',
    desc: 'A heavy fleece fabric with an intensively brushed and napped interior that traps air for extreme warmth. Denser and heavier than standard three-thread fleece — built for cold-weather outerwear and heavy workwear.',
    gsm: '320 – 500 GSM',
    gauge: '14 – 18 GG',
    yarn: 'Polyester, Cotton-Polyester blends, Acrylic blends',
    construction: 'Fleece base with heavily brushed, dense napped interior',
    properties: ['Dense napped interior', 'Maximum thermal insulation', 'Heavy, substantial body', 'Wind-resistant outer face', 'Durable pile structure'],
    applications: ['Winter Jackets', 'Heavy Hoodies', 'Cold Weather Garments', 'Workwear', 'Outdoor Wear'],
    bgClass: 'fabric-russian-bg',
  },
  AP: {
    name: 'Antipilling',
    subtitle: 'Pill-Resistant Engineered Knit',
    desc: 'Uses modified fibres with lower tenacity and specific yarn twist to prevent surface fibres from tangling into pills. The fabric maintains its original appearance through heavy wash cycles — critical for childrenswear and quality sportswear.',
    gsm: '160 – 280 GSM',
    gauge: '20 – 28 GG',
    yarn: 'Anti-pill Polyester, Modified Cotton blends, Microfibre',
    construction: 'Modified fibre and stitch engineering for surface stability',
    properties: ['Pill-resistant surface', 'Maintains new appearance', 'Durable through washing', 'Smooth consistent finish', 'Colour-fast'],
    applications: ['Sportswear', "Children's Wear", 'Quality Innerwear', 'Workwear', 'Uniforms'],
    bgClass: 'fabric-anti-bg',
  },
  WF: {
    name: 'Waffle Knit',
    subtitle: '3D Square Cell Thermal Structure',
    desc: 'Knit and purl stitches alternate in a grid pattern to create a three-dimensional honeycomb-like cell structure. The raised squares trap air between the fabric and skin, providing warmth-to-weight efficiency well above a plain jersey of the same GSM.',
    gsm: '200 – 320 GSM',
    gauge: '16 – 24 GG',
    yarn: 'Cotton, CVC, Bamboo, Modal blends',
    construction: 'Alternating knit-purl grid creating 3D square cells',
    properties: ['3D cell structure traps warmth', 'Efficient warmth-to-weight ratio', 'Distinctive textural surface', 'Good stretch and recovery', 'Soft against skin'],
    applications: ['Thermal Wear', 'Bathrobes', 'Casual Fashion', 'Loungewear', 'Babywear'],
    bgClass: 'fabric-waffle-bg',
  },
  PK: {
    name: 'P-Knit',
    subtitle: 'Reversible Double-Faced Knit',
    desc: 'Alternating knit and purl courses produce a fabric with horizontal ridges and a reversible structure — both faces are usable. The resulting fabric has a firm body, excellent stability, and a distinctive horizontal texture.',
    gsm: '220 – 340 GSM',
    gauge: '14 – 22 GG',
    yarn: 'Cotton, CVC, Wool-like Polyester, Acrylic blends',
    construction: 'Alternating knit-purl courses, reversible double-face',
    properties: ['Reversible — both faces usable', 'Horizontal ridge texture', 'Firm, structured body', 'Good dimensional stability', 'Premium fashion hand'],
    applications: ['Fashion Knitwear', 'Babywear', 'Casual Tops', 'Premium Loungewear', 'Designer Collections'],
    bgClass: 'fabric-pknit-bg',
  },
  RK: {
    name: 'Rice Knit',
    subtitle: 'Fine Seed-Texture Knit',
    desc: 'Knit-purl stitch combinations create a fine, even seed-like texture across the fabric surface. Subtle enough to read as premium without overpowering garment design — a popular upgrade from plain Single Jersey for fashion basics.',
    gsm: '160 – 260 GSM',
    gauge: '20 – 28 GG',
    yarn: 'Cotton, CVC, Bamboo, Lyocell blends',
    construction: 'Knit-purl stitch combinations in a fine repeating grid',
    properties: ['Subtle seed texture', 'Elevated fabric appearance', 'Good drape', 'Lightweight to medium weight', 'Soft hand feel'],
    applications: ['Fashion Tops', 'Casual Wear', 'Polo Shirts', "Women's Wear", 'Premium Basics'],
    bgClass: 'fabric-rice-bg',
  },
  DK: {
    name: 'Dot Knit',
    subtitle: 'Pointelle Tuck Stitch Knit',
    desc: 'Tuck stitches are strategically placed to create a decorative pointelle dot effect — small, symmetrical eyelet-like openings in the fabric surface. Lightweight and feminine with a delicate, semi-sheer appearance in finer counts.',
    gsm: '140 – 220 GSM',
    gauge: '20 – 28 GG',
    yarn: 'Cotton, Bamboo, Lyocell, Modal blends',
    construction: 'Tuck stitch in repeating dot pattern on jersey ground',
    properties: ['Decorative dot pattern', 'Lightweight and airy', 'Feminine drape', 'Semi-sheer in fine counts', 'Distinctive pointelle effect'],
    applications: ["Women's Wear", 'Fashion Garments', 'Casual Tops', 'Knitwear Collections', 'Occasion Wear'],
    bgClass: 'fabric-dot-bg',
  },
  MPP: {
    name: 'Micro-PP',
    subtitle: 'Fine-Gauge Performance Microfibre',
    desc: 'Knitted in fine gauge using polypropylene or micro-denier polyester fibres. PP fibres are hydrophobic by nature — they push moisture away from the skin to the fabric surface where it evaporates. Exceptionally light and quick-drying.',
    gsm: '120 – 200 GSM',
    gauge: '28 – 36 GG',
    yarn: 'Polypropylene (PP), Micro Polyester, PP blends',
    construction: 'Fine-gauge microfibre knit, single or interlock structure',
    properties: ['Ultra lightweight', 'Moisture wicking', 'Quick drying', 'Odour resistant', 'Non-absorbent base fibre'],
    applications: ['Activewear', 'Base Layers', 'Performance Wear', 'Athletic Innerwear', 'Sports Underlayers'],
    bgClass: 'fabric-micro-bg',
  },
  TK: {
    name: 'Towel Knit',
    subtitle: 'Dense Loop-Pile Knit',
    desc: 'A dense, high-loop-pile knit structure engineered for maximum absorbency and a plush hand feel. The loop height and pile density are controlled to achieve the right balance of softness, absorbency, and durability for home-textile applications.',
    gsm: '300 – 500 GSM',
    gauge: '16 – 22 GG',
    yarn: '100% Cotton, Bamboo Cotton, Ring-spun Cotton',
    construction: 'High-density loop-pile on jersey ground structure',
    properties: ['High moisture absorbency', 'Plush hand feel', 'Dense pile structure', 'Durable loop construction', 'Softens with washing'],
    applications: ['Face Towels', 'Hand Towels', 'Bath Linen', 'Beach Towels', 'Spa Textiles'],
    bgClass: 'fabric-tv-bg',
  },
  FS: {
    name: 'Feeder Stripes',
    subtitle: 'Yarn-Fed Colour Stripe Knit',
    desc: 'Colour is introduced directly at the yarn feeder during knitting — each stripe is a different yarn colour, not a printed or dyed pattern. The result is a colourfast, print-free stripe that runs the full width of the fabric with crisp definition.',
    gsm: '160 – 280 GSM',
    gauge: '20 – 28 GG',
    yarn: 'Cotton, CVC, Polyester — in multiple colours per roll',
    construction: 'Multi-feeder single jersey; colours changed per course at feeder',
    properties: ['Colour knitted in, not printed', 'Colourfast and wash-durable', 'Crisp stripe definition', 'No colour bleeding between stripes', 'Flexible stripe width'],
    applications: ['Striped T-Shirts', 'Sportswear', 'School Uniforms', 'Casual Wear', 'Kidswear'],
    bgClass: 'fabric-stripe-bg',
  },
  HC: {
    name: 'Honeycomb',
    subtitle: 'Hexagonal Cell Texture Knit',
    desc: 'A structured knit where tuck and knit stitches combine to form a hexagonal cell pattern on the fabric surface. The raised cells create air pockets for breathability while the dimensional surface adds visual and tactile interest.',
    gsm: '180 – 280 GSM',
    gauge: '18 – 24 GG',
    yarn: 'Cotton, CVC, Polyester blends',
    construction: 'Tuck and knit stitch combination creating hexagonal cells',
    properties: ['3D hexagonal surface pattern', 'Breathable air pockets', 'Structured and firm', 'Good shape retention', 'Distinctive premium texture'],
    applications: ['Polo Shirts', 'Casual Wear', 'Fashion Tops', 'Corporate Wear', 'Premium T-Shirts'],
    bgClass: 'fabric-honey-bg',
  },
  FN: {
    name: 'Fancy Structures',
    subtitle: 'Custom Engineered Knit Constructions',
    desc: 'Complex multi-stitch constructions developed for fashion and export. Includes jacquard effects, engineered texture combinations, mixed-gauge structures, and custom repeat patterns. Each design is developed to your brief and sampled before bulk production.',
    gsm: 'Custom — per design brief',
    gauge: 'Custom — per pattern requirement',
    yarn: 'Any — Cotton, Polyester, CVC, Bamboo, Spandex, blends',
    construction: 'Multi-stitch: Jacquard, tuck, float, plating combinations',
    properties: ['Fully custom construction', 'Premium aesthetic appeal', 'Unique texture and pattern', 'Export-quality execution', 'Sample before bulk'],
    applications: ['Fashion Wear', 'Premium Export Collections', 'Designer Collaborations', 'Custom Brand Projects', 'Luxury Garments'],
    bgClass: 'fabric-fancy-bg',
  },
};

const modal      = document.getElementById('fabric-modal');
const modalPanel = modal?.querySelector('.modal-panel');

function openModal(code) {
  const p = PRODUCTS[code];
  if (!p || !modal) return;

  document.getElementById('modal-visual').className = 'modal-visual ' + p.bgClass;
  const modalImg = document.getElementById('modal-img');
  if (modalImg) {
    modalImg.src = `images/fabric-${code.toLowerCase()}.svg`;
    modalImg.alt = `${p.name} fabric texture`;
  }
  document.getElementById('modal-code').textContent = code;
  document.getElementById('modal-badge').textContent = code;
  document.getElementById('modal-title').textContent = p.name;
  document.getElementById('modal-subtitle').textContent = p.subtitle;
  document.getElementById('modal-desc').textContent = p.desc;

  document.getElementById('modal-specs').innerHTML = [
    { label: 'GSM Range',     val: p.gsm },
    { label: 'Gauge',         val: p.gauge },
    { label: 'Construction',  val: p.construction },
    { label: 'Yarn Types',    val: p.yarn },
  ].map(s => `<div class="modal-spec-item"><div class="modal-spec-label">${s.label}</div><div class="modal-spec-val">${s.val}</div></div>`).join('');

  document.getElementById('modal-props').innerHTML =
    p.properties.map(pr => `<span class="modal-prop">${pr}</span>`).join('');

  document.getElementById('modal-apps').innerHTML =
    p.applications.map(a => `<span class="modal-app">${a}</span>`).join('');

  const wa = encodeURIComponent(`Hello, I am interested in your ${p.name} fabric. Please share GSM, gauge, and pricing details.`);
  document.getElementById('modal-enquire').href = `contact.html?fabric=${code}`;
  document.getElementById('modal-wa').href = `https://wa.me/918360180643?text=${wa}`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  modalPanel?.scrollTo(0, 0);
}

function closeModal() {
  modal?.classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('.product-card[data-product]').forEach(card => {
  card.addEventListener('click', () => openModal(card.dataset.product));
});

modal?.querySelector('.modal-close')?.addEventListener('click', closeModal);

modal?.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
