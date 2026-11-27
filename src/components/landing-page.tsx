'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './landing-page.module.css';

const stages = [
  { title: 'Nhận diện tại FPGA.', label: 'PHÁT HIỆN', text: 'FPGA phân loại lưu lượng mạng và đưa sự kiện vào hàng đợi cảnh báo. Bắt đầu từ nơi dữ liệu đi qua.', tag: 'FPGA · Phân loại lưu lượng' },
  { title: 'Kết nối không dây.', label: 'TRUYỀN DỮ LIỆU', text: 'ESP32 nhận cảnh báo, lưu vào outbox bền vững và gửi qua Wi-Fi bằng HTTPS. Khi mất mạng, bản ghi chờ để gửi lại.', tag: 'ESP32 · Wi-Fi · HTTPS' },
  { title: 'Hiển thị tức thời.', label: 'QUAN SÁT', text: 'Cảnh báo đã lưu đồng bộ lên dashboard qua Firestore. Đăng nhập để theo dõi các thiết bị được cấp quyền trong nhóm của bạn.', tag: 'Cloud · Realtime dashboard' },
];

function Shield({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 3 35 9v12c0 9-8 16-15 20C13 37 5 30 5 21V9L20 3Z" stroke="currentColor" strokeWidth="1.5"/><path d="m13 22 5 5 10-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function NetworkCore() {
  const glowId = useId();
  return <div className={styles.coreScene} aria-hidden="true">
    <div className={styles.orbitOuter}/><div className={styles.orbitInner}/>
    <svg className={styles.constellation} viewBox="0 0 620 620" fill="none">
      <defs><radialGradient id={glowId}><stop stopColor="#97ffd1" stopOpacity=".25"/><stop offset="1" stopColor="#97ffd1" stopOpacity="0"/></radialGradient></defs>
      <circle cx="310" cy="310" r="265" fill={`url(#${glowId})`}/>
      {[0,1,2,3,4,5].map(i => <ellipse key={i} cx="310" cy="310" rx={80+i*30} ry="225" transform={`rotate(${i*30} 310 310)`} stroke="#9bf6ce" strokeOpacity=".17"/>)}
      <path d="M95 185 310 92l216 93-1 248-215 96L95 433V185Zm0 0 430 248M526 185 95 433M310 92v437M95 185l215 125 216-125M95 433l215-123 215 123" stroke="#9bf6ce" strokeOpacity=".32"/>
      {[[95,185],[310,92],[526,185],[525,433],[310,529],[95,433],[310,310]].map(([cx,cy], i) => <g key={i}><circle cx={cx} cy={cy} r="12" fill="#9bf6ce" fillOpacity=".08"/><circle cx={cx} cy={cy} r="3" fill="#b7ffdb"/></g>)}
    </svg>
    <div className={styles.coreChip}><div className={styles.chipPins}/><Shield/><span>OTT<span>IDS</span></span><small>NETWORK INTELLIGENCE</small></div>
    <div className={`${styles.coreLabel} ${styles.labelTop}`}><span/> FPGA ENGINE</div>
    <div className={`${styles.coreLabel} ${styles.labelBottom}`}>ENCRYPTED UPLINK <span/></div>
  </div>;
}

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let disposed = false;
    let revert: (() => void) | undefined;
    // Load animation code only on the introduction route. Content remains readable without JS.
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (disposed || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia();
      media.add({ motion: '(prefers-reduced-motion: no-preference)', desktop: '(min-width: 900px)' }, context => {
        if (!context.conditions?.motion) return;
        const desktop = context.conditions.desktop;
        gsap.from('[data-hero]', { y: 35, opacity: 0, duration: 1.1, stagger: .12, ease: 'power3.out' });
        gsap.from('[data-core]', { scale: .85, opacity: 0, rotation: -12, duration: 1.6, ease: 'power3.out' });
        gsap.to('[data-core]', { y: desktop ? 90 : 25, rotation: 10, ease: 'none', scrollTrigger: { trigger: '[data-hero-section]', start: 'top top', end: 'bottom top', scrub: 1 } });
        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach(element => {
          gsap.from(element, { y: desktop ? 55 : 25, opacity: 0, duration: .85, ease: 'power2.out', scrollTrigger: { trigger: element, start: 'top 90%', once: true } });
        });
        gsap.to('[data-trace]', { scaleY: 1, transformOrigin: 'top', ease: 'none', scrollTrigger: { trigger: '[data-system]', start: 'top 65%', end: 'bottom 75%', scrub: .7 } });
        if (desktop) {
          gsap.to('[data-sticky-core]', { rotation: 35, scale: 1.08, ease: 'none', scrollTrigger: { trigger: '[data-system]', start: 'top center', end: 'bottom center', scrub: 1.2 } });
          gsap.from('[data-preview]', { rotateY: -18, rotateX: 9, y: 70, ease: 'none', scrollTrigger: { trigger: '[data-preview]', start: 'top bottom', end: 'center 55%', scrub: 1 } });
        }
      }, root);
      revert = () => media.revert();
    }).catch(() => { /* Progressive enhancement: the complete page remains visible. */ });
    return () => { disposed = true; revert?.(); };
  }, []);

  function closeMenu() { setMenuOpen(false); }
  return <div ref={root} className={styles.landing}>
    <a className={styles.skip} href="#main">Đến nội dung chính</a>
    <header className={styles.header}><Link href="/" className={styles.logo} aria-label="OTT-IDS trang chủ"><Shield/>OTT<span>-IDS</span></Link>
      <nav className={styles.desktopNav} aria-label="Điều hướng chính"><a href="#platform">Nền tảng</a><a href="#system">Cách hoạt động</a><a href="#insight">Giám sát</a></nav>
      <Link className={styles.headerCta} href="/dashboard">Vào dashboard</Link>
      <button className={styles.menuButton} aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Đóng' : 'Menu'}<span>{menuOpen ? '−' : '+'}</span></button>
      {menuOpen ? <nav id="mobile-navigation" className={styles.mobileNav} aria-label="Điều hướng di động" onKeyDown={event => { if (event.key === 'Escape') { closeMenu(); document.querySelector<HTMLButtonElement>(`button[aria-controls="mobile-navigation"]`)?.focus(); } }}><a onClick={closeMenu} href="#platform">Nền tảng</a><a onClick={closeMenu} href="#system">Cách hoạt động</a><a onClick={closeMenu} href="#insight">Giám sát</a><Link onClick={closeMenu} href="/dashboard">Vào dashboard</Link></nav> : null}
    </header>
    <main id="main">
      <section className={styles.hero} data-hero-section>
        <div className={styles.heroCopy}><p className={styles.kicker} data-hero><span/> NETWORK SECURITY, CONNECTED.</p><h1 data-hero>Nhìn thấu<br/>mối đe dọa.<br/><span>Chủ động bảo vệ.</span></h1><p className={styles.heroDescription} data-hero>Từ sức mạnh phần cứng đến khả năng quan sát trên cloud. OTT-IDS kết nối FPGA, ESP32 và dashboard trong một luồng cảnh báo liền mạch.</p><div className={styles.heroActions} data-hero><Link className={styles.primaryButton} href="/dashboard">Mở trung tâm giám sát</Link><a className={styles.textLink} href="#system">Khám phá hệ thống</a></div><div className={styles.heroFootnote} data-hero><span>FPGA Detection</span><i/><span>Wireless Connectivity</span><i/><span>Realtime Alerts</span></div></div>
        <div className={styles.heroVisual} data-core><NetworkCore/></div>
        <div className={styles.heroBottom}><span>THIẾT KẾ CHO KHẢ NĂNG QUAN SÁT</span><a href="#platform">Cuộn để khám phá</a></div>
      </section>
      <section id="platform" className={styles.platform}>
        <div className={styles.sectionHeading} data-reveal><p className={styles.kicker}>TỪ THIẾT BỊ ĐẾN TẦM NHÌN TỔNG THỂ</p><h2>Mạng vẫn chuyển động.<br/><span>Bạn luôn nắm bắt.</span></h2><p>Đưa tín hiệu từ phần cứng thành thông tin rõ ràng. Một nơi để nhận biết tấn công, theo dõi sự kiện và quản lý lịch sử cảnh báo.</p></div>
        <div className={styles.featureGrid}>
          <article data-reveal><div className={styles.featureVisual}><div className={styles.waveform}>{Array.from({ length: 37 }, (_,i) => <span key={i} style={{ height: `${15 + ((i*37)%75)}%` }}/>)}</div><span className={styles.visualCaption}>TRAFFIC → CLASSIFICATION</span></div><h3>Phân loại từ phần cứng</h3><p>FPGA xử lý phân loại. ESP32 tiếp nhận bản ghi để đưa cảnh báo đến hệ thống giám sát.</p></article>
          <article data-reveal><div className={styles.featureVisual}><div className={styles.signalRings}><span/><span/><span/><b>Wi-Fi</b></div><span className={styles.visualCaption}>LOCAL OUTBOX · HTTPS</span></div><h3>Kết nối có khả năng phục hồi</h3><p>Outbox trên ESP32 giữ bản ghi khi mất kết nối, gửi lại khi mạng sẵn sàng và chống trùng tại server.</p></article>
          <article data-reveal><div className={styles.featureVisual}><div className={styles.miniAlert}><Shield/><span>Tấn công <small>Class 1 · Cảnh báo</small></span><b>!</b></div><span className={styles.visualCaption}>MINH HỌA GIAO DIỆN</span></div><h3>Điểm nóng được làm nổi bật</h3><p>Class 1 có nhãn đỏ và hiệu ứng chú ý khi nhận mới, giúp bạn nhận ra sự kiện cần xem xét.</p></article>
        </div>
      </section>
      <section id="system" className={styles.system} data-system>
        <div className={styles.systemIntro}><p className={styles.kicker} data-reveal>MỘT HỆ THỐNG. MỘT LUỒNG DỮ LIỆU.</p><h2 data-reveal>Từ gói tin.<br/>Đến <em>góc nhìn.</em></h2><div className={styles.smallCore} data-sticky-core><NetworkCore/></div><p className={styles.systemNote}>Phần cứng ở hiện trường.<br/>Thông tin ở ngay trong tầm tay.</p></div>
        <div className={styles.stages}><div className={styles.trace}><div data-trace/></div>{stages.map(stage => <article key={stage.label} className={styles.stage} data-reveal><span className={styles.stageDot}/><p className={styles.kicker}>{stage.label}</p><h3>{stage.title}</h3><p>{stage.text}</p><span className={styles.stageTag}>{stage.tag}</span></article>)}</div>
      </section>
      <section id="insight" className={styles.insight}>
        <div className={styles.insightCopy} data-reveal><p className={styles.kicker}>THÔNG TIN RÕ RÀNG. THAO TÁC TẬP TRUNG.</p><h2>Đúng cảnh báo.<br/>Đúng <span>ngữ cảnh.</span></h2><p>Theo dõi địa chỉ nguồn, đích, giao thức và hành động trong cùng một giao diện. Tìm nhanh sự kiện theo IP, cổng hoặc phân loại.</p><ul><li>Đăng nhập và phân quyền theo nhóm thiết bị</li><li>Cập nhật cảnh báo qua Firestore realtime</li><li>Owner có thể xóa các cảnh báo đang hiển thị</li></ul><Link href="/dashboard" className={styles.textLink}>Truy cập dashboard</Link></div>
        <div className={styles.preview} data-preview><div className={styles.previewBar}><span><i/><i/><i/></span><small>OTT-IDS / DASHBOARD</small><span className={styles.demoPill}>MINH HỌA</span></div><div className={styles.previewBody}><div className={styles.previewTitle}>Trung tâm giám sát <span>IDS-0001</span></div><div className={styles.previewStats}><div><span>Cảnh báo</span><b>03</b></div><div><span>Tấn công · Class 1</span><b>01</b></div><div><span>Thiết bị</span><b>ESP32</b></div></div><div className={styles.previewTable}><div><span>PHÂN LOẠI</span><span>NGUỒN</span><span>GIAO THỨC</span></div>{['Tấn công · Class 1','Class 0','Class 0'].map((label,i) => <div key={i}><span className={i === 0 ? styles.demoAttack : ''}>{label}</span><span>192.0.2.{10+i}</span><span>{i===1 ? 'TCP' : 'UDP'}</span></div>)}</div><p className={styles.previewDisclaimer}>Dữ liệu minh họa giao diện, không phải cảnh báo trực tiếp.</p></div></div>
      </section>
      <section className={styles.cta} data-reveal><div className={styles.ctaHalo}/><Shield/><p className={styles.kicker}>OTT-IDS · NETWORK INTELLIGENCE</p><h2>Mỗi tín hiệu.<br/>Một góc nhìn rõ hơn.</h2><p>Kết nối với hệ thống của bạn và bắt đầu theo dõi cảnh báo.</p><Link href="/dashboard" className={styles.primaryButton}>Vào trung tâm giám sát</Link></section>
    </main>
    <footer className={styles.footer}><Link className={styles.logo} href="/">OTT<span>-IDS</span></Link><span>FPGA × ESP32 × CLOUD</span><a href="#main">Về đầu trang</a></footer>
  </div>;
}
