(() => {
  const payload = document.getElementById('report-data');
  if (!payload) return;
  const D = JSON.parse(payload.textContent || '{}');
  const charts = D.report_charts || {};
  const NS = 'http://www.w3.org/2000/svg';
  const colors = {
    ochre: '#8A4B00', coral: '#D55E00', plum: '#CC79A7', teal: '#009E73',
    api: '#0072B2', mcp: '#D55E00', direct: '#009E73', other: '#CC79A7', unknown: '#6B7280',
    report: '#0072B2', game: '#D55E00', test: '#8A4B00', learning: '#009E73', tool: '#005A8D', article: '#CC79A7',
    unclassified: '#6B7280', edgeFallback: '#0072B2', unverified: '#D55E00', verified: '#111820', ai: '#CC79A7'
  };
  let lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';

  const text = (zh, en) => lang === 'en' ? en : zh;
  const sourceLabels = {
    api: ['API 标签', 'API label'], mcp: ['MCP 标签', 'MCP label'], direct: ['网页入口标签', 'Web UI label'],
    other: ['其他标签', 'Other labels'], unknown: ['未填写', 'Not provided']
  };
  const sourceShort = {api: 'API', mcp: 'MCP', direct: ['网页', 'Web UI'], other: ['其他', 'Other'], unknown: ['缺失', 'Missing']};
  const categoryNames = {
    '报告与研究': ['报告与研究', 'Reports & research'],
    '游戏与互动叙事': ['游戏与互动叙事', 'Games & interactive stories'],
    '测试与占位': ['测试与占位', 'Tests & placeholders'],
    '学习与教学': ['学习与教学', 'Learning & teaching'],
    '互动工具与小应用': ['互动工具与小应用', 'Interactive tools & small apps'],
    '文章与指南': ['文章与指南', 'Articles & guides'],
    '其他用途': ['其他已识别用途', 'Other identified purposes'],
    '未分类': ['未分类', 'Unclassified']
  };
  const categoryColors = {
    '报告与研究': colors.report, '游戏与互动叙事': colors.game, '测试与占位': colors.test,
    '学习与教学': colors.learning, '互动工具与小应用': colors.tool, '文章与指南': colors.article,
    '其他用途': colors.plum, '未分类': colors.unclassified
  };
  const milestoneLabels = {
    seo_discovery_metadata: ['SEO 与发现元数据', 'SEO and discovery metadata'],
    readonly_webmcp_remote_mcp: ['只读 WebMCP 与 remote MCP', 'Read-only WebMCP and remote MCP'],
    sitemap_homepage_only: ['站点地图仅含首页', 'Sitemap limited to the homepage'],
    create_share_tools_and_structured_homepage: ['首页结构化信息；工具可创建分享', 'Structured homepage; tools can create shares'],
    private_sharing_product_pages_discovery: ['私密分享、产品页与发现信息', 'Private links, product pages, and discovery'],
    remote_mcp_machine_origin: ['remote MCP 改用 workers.dev 主机', 'Remote MCP moved to a workers.dev host'],
    registry_identity_change: ['Agent registry 身份更新', 'Agent registry identity update'],
    production_deployment_window: ['观察到一段生产部署窗口', 'A production deployment window was observed'],
    edge_collection_start: ['开始收集主站边缘观测', 'Main-host edge collection began'],
    creation_window_start: ['分享记录观察期开始', 'Share-record observation window began'],
    first_nonempty_source: ['首次出现非空来源标签', 'First non-empty source label appeared'],
    first_mcp_label: ['首次观察到 MCP 创建标签', 'First MCP creation label observed'],
    edge_missing_day: ['主站边缘数据缺日', 'Main-host edge data has a missing day'],
    last_edge_day: ['主站边缘观察最后一日', 'Last day in the main-host edge window'],
    frozen_snapshot_cutoff: ['冻结快照截点', 'Frozen snapshot cutoff']
  };
  const eventDetails = {
    seo_discovery_metadata: ['SEO 与发现元数据', 'SEO and discovery metadata'],
    readonly_webmcp_remote_mcp: ['只读 WebMCP 与 remote MCP', 'Read-only WebMCP and remote MCP'],
    sitemap_homepage_only: ['sitemap 当时仅包含首页', 'Sitemap then included the homepage only'],
    create_share_tools_and_structured_homepage: ['结构化首页与可创建分享的工具', 'Structured homepage and share-creation tools'],
    private_sharing_product_pages_discovery: ['私密分享、产品页与发现信息', 'Private sharing, product pages, and discovery metadata'],
    remote_mcp_machine_origin: ['remote MCP 迁至 workers.dev 主机', 'Remote MCP moved to a workers.dev host'],
    first_nonempty_source: ['首次记录到非空创建来源标签', 'First non-empty creation-source label recorded'],
    first_mcp_label: ['首次记录到 MCP 创建标签', 'First MCP creation label recorded']
  };
  const milestoneEvidence = {
    seo: {
      title: ['SEO：能看到访问路径，无法确认搜索成效', 'SEO: routes are visible; search outcomes are not'],
      observed: ['代码记录显示 5 月 26 日加入发现元数据，6 月 6 日扩展首页结构。主站 robots.txt 观察 1,162 次、sitemap.xml 475 次。', 'Code history shows discovery metadata on May 26 and expanded homepage structure on June 6. The main host recorded 1,162 robots.txt and 475 sitemap.xml observations.'],
      missing: ['缺搜索曝光、点击、索引状态与从搜索到创建的关联；请求数不代表已收录。', 'Search impressions, clicks, indexing status, and a search-to-creation link are missing. Requests do not prove indexing.']
    },
    geo: {
      title: ['GEO：可见少量 AI 爬虫标签，不能归因访问或引用', 'GEO: some AI crawler labels appear, but visits or citations cannot be attributed'],
      observed: ['旧版 AI user-agent 聚合有 1,852 条观测，是边缘基本总数的重叠子集，不是额外流量。', 'The legacy AI user-agent aggregate has 1,852 observations, overlapping the edge base total rather than adding to it.'],
      missing: ['缺 AI 答案曝光、引用、实际读者来源和创建链路；user-agent 名称可被伪装。', 'AI answer exposure, citations, reader referrals, and a creation link are absent. User-agent names can be spoofed.']
    },
    webmcp: {
      title: ['WebMCP：功能存在，不等于调用成功', 'WebMCP: feature presence does not prove successful calls'],
      observed: ['代码时间线显示 5 月只读能力，6 月 6 日加入创建分享工具；7 月 19 日上传路径开始写来源标签。', 'The code timeline shows read-only capability in May, share-creation tools on June 6, and a source label on the upload path on July 19.'],
      missing: ['历史快照没有可验证的浏览器方法调用、工具结果或失败记录；MCP 标签由调用方提供。', 'The historical snapshot has no verified browser method-call, tool-result, or failure record. MCP labels are caller supplied.']
    },
    remote: {
      title: ['Remote MCP：主站观测不覆盖 workers.dev 直连', 'Remote MCP: main-host observations miss direct workers.dev calls'],
      observed: ['8 月 10 日首次出现 MCP 创建标签；主站 /mcp 路径有 108 条观测。', 'The first MCP-labeled creation appears on August 10; the main-host /mcp path has 108 observations.'],
      missing: ['7 月 19 日后远端 MCP 使用 workers.dev；主站请求量不能与创建量计算采用率。缺少独立的调用、成功与错误事件。', 'After July 19, remote MCP used workers.dev. Main-host requests cannot be compared with creations as an adoption rate. Separate call, success, and error events are missing.']
    }
  };

  const fmt = (n, max = 0) => Number(n || 0).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {maximumFractionDigits: max});
  const pct = (n, den) => den ? `${(100 * n / den).toFixed(1)}%` : '0%';
  const sourceColor = k => colors[k] || colors.unknown;
  const categoryLabel = k => (categoryNames[k] || [k, k])[lang === 'en' ? 1 : 0];
  const sourceLabel = k => (sourceLabels[k] || sourceLabels.unknown)[lang === 'en' ? 1 : 0];
  const categoryKey = k => ({
    '报告与研究':'report', '游戏与互动叙事':'game', '测试与占位':'test', '学习与教学':'learning',
    '互动工具与小应用':'tool', '文章与指南':'article', '其他用途':'other', '未分类':'unclassified'
  })[k] || 'unclassified';
  function el(tag, attrs = {}, content) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    if (content != null) node.textContent = content;
    return node;
  }
  function svg(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (parent) parent.appendChild(node);
    return node;
  }
  function setTitle(svgNode, zh, en) {
    svgNode.setAttribute('aria-label', text(zh, en));
    const title = svg('title', {}, svgNode); title.textContent = text(zh, en);
  }
  function clear(id) { const node = document.getElementById(id); if (node) node.replaceChildren(); return node; }
  function setSvg(id, viewBox, zh, en) {
    const node = clear(id); if (!node) return null;
    node.setAttribute('viewBox', viewBox); node.setAttribute('preserveAspectRatio', 'xMinYMin meet'); node.setAttribute('role', 'img');
    setTitle(node, zh, en); return node;
  }
  function legendInto(id, items) {
    const box = clear(id); if (!box) return;
    items.forEach(([key, color, label]) => {
      const item = el('span', {class:'legend-item'});
      item.append(el('i', {class:'legend-swatch', style:`background:${color}`}));
      item.append(document.createTextNode(label)); box.append(item);
    });
  }
  function dataTable(id, caption, headers, rows) {
    const host = clear(id); if (!host) return;
    const details = el('details');
    const summary = el('summary', {text: text('展开数据表', 'Open data table')});
    const wrap = el('div', {class:'table-scroll'});
    const table = document.createElement('table');
    const cap = document.createElement('caption'); cap.textContent = caption; cap.className = 'visually-hidden'; table.append(cap);
    const thead = document.createElement('thead'), trh = document.createElement('tr');
    headers.forEach(h => trh.append(el('th', {scope:'col', text:h})));
    thead.append(trh); table.append(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(row => { const tr = document.createElement('tr'); row.forEach((cell, i) => tr.append(el(i === 0 ? 'th':'td', i === 0 ? {scope:'row',text:String(cell)} : {text:String(cell)}))); tbody.append(tr); });
    table.append(tbody); wrap.append(table); details.append(summary, wrap); host.append(details);
  }
  function sourceCounts(row) { return row.sources || {}; }
  function groupSourceCounts(raw) {
    const result = {api:0,mcp:0,direct:0,other:0,unknown:0};
    Object.entries(raw || {}).forEach(([key, count]) => {
      if (key === 'api' || key === 'mcp' || key === 'direct') result[key] += count;
      else if (key === '(null)' || key === 'unknown' || key == null) result.unknown += count;
      else result.other += count;
    });
    return result;
  }
  function makeLegendSources(id) {
    legendInto(id, ['api','mcp','direct','other','unknown'].map(k => [k, sourceColor(k), sourceLabel(k)]));
  }
  function axis(svgNode, x0, y0, w, h, max, ticks, formatter = n => fmt(n)) {
    ticks.forEach(t => {
      const y = y0 + h - (t / max) * h;
      svg('line', {x1:x0,y1:y,x2:x0+w,y2:y,class:'gridline'}, svgNode);
      const label = svg('text', {x:x0-9,y:y+4,'text-anchor':'end',class:'axis-label'}, svgNode); label.textContent = formatter(t);
    });
    svg('line',{x1:x0,y1:y0,x2:x0,y2:y0+h,class:'axis-rule'},svgNode);
    svg('line',{x1:x0,y1:y0+h,x2:x0+w,y2:y0+h,class:'axis-rule'},svgNode);
  }
  function svgAxisTitles(svgNode,x0,y0,w,h,viewHeight,xTitle,yTitle){
    const x=svg('text',{x:x0+w/2,y:viewHeight-5,'text-anchor':'middle',class:'axis-label'},svgNode);x.textContent=xTitle;
    const mid=y0+h/2;const y=svg('text',{x:15,y:mid,transform:`rotate(-90 15 ${mid})`,'text-anchor':'middle',class:'axis-label'},svgNode);y.textContent=yTitle;
  }
  function htmlBarAxes(host,{x,y,max,formatter=n=>fmt(n),kind='horizontal-axis',columns='minmax(7rem,24%) 1fr 4.7rem'}){
    const title=el('div',{class:`${kind}-title`});title.style.gridTemplateColumns=columns;
    title.append(el('span',{text:`Y · ${y}`}),el('span',{text:`X · ${x}`}),el('span',{text:''}));
    const tickrow=el('div',{class:`${kind}-ticks`});tickrow.style.gridTemplateColumns=columns;
    const ticks=el('div',{class:'ticks'});[0,max/2,max].forEach(value=>ticks.append(el('span',{text:formatter(value)})));
    tickrow.append(el('span'),ticks,el('span'));
    host.prepend(title,tickrow);
  }
  function renderDaily() {
    const rows = charts.creation_daily || [];
    const node = setSvg('creation-chart', '0 0 1180 370', '每日创建记录与七日均线，台北时间', 'Daily creation records and seven-day mean, Taipei time');
    if (!node || !rows.length) return;
    const x0=58, y0=22, w=1092, h=250, max=Math.ceil(Math.max(...rows.map(r=>r.records), 1)/50)*50;
    const defs=svg('defs',{},node), pattern=svg('pattern',{id:'creation-partial-hatch',width:7,height:7,patternUnits:'userSpaceOnUse'},defs);
    svg('rect',{width:7,height:7,fill:colors.api},pattern);
    svg('path',{d:'M-1 1 L1 -1 M0 7 L7 0 M6 8 L8 6',stroke:'#FFFFFF','stroke-width':1.5,'stroke-opacity':.9},pattern);
    axis(node,x0,y0,w,h,max,[0,max/4,max/2,max*3/4,max],n=>fmt(Math.round(n)));
    const step=w/rows.length, bw=Math.max(3,step*.68);
    rows.forEach((r,i)=>{
      const x=x0+i*step+(step-bw)/2, bh=(r.records/max)*h, y=y0+h-bh;
      const rect=svg('rect',{x,y,width:bw,height:Math.max(.8,bh),fill:r.partial_day?'url(#creation-partial-hatch)':colors.api,class:'chart-bar'},node);
      const title=svg('title',{},rect); title.textContent=`${r.date}: ${fmt(r.records)} ${text('条记录','records')}${r.partial_day?` · ${text('截至 23:27 台北时间的部分日；末值七日均线含此日','partial through 23:27 Taipei time; final seven-day mean includes this day')}`:''}`;
      if (r.partial_day) svg('rect',{x:x-1,y:y-1,width:bw+2,height:bh+2,fill:'none',stroke:colors.verified,'stroke-width':1.3},node);
    });
    const points=[];
    rows.forEach((r,i)=>{ if (r.trailing_7_day_mean != null) points.push(`${x0+i*step+step/2},${y0+h-(r.trailing_7_day_mean/max)*h}`); });
    if(points.length) svg('polyline',{points:points.join(' '),class:'mean-line'},node);
    rows.forEach((r,i)=>{
      if(r.trailing_7_day_mean!=null && (i%7===6 || i===rows.length-1)){
        svg('circle',{cx:x0+i*step+step/2,cy:y0+h-(r.trailing_7_day_mean/max)*h,r:3.5,class:'mean-dot'},node);
        const title=svg('title',{},node.lastChild); title.textContent=`${r.date}: ${fmt(r.trailing_7_day_mean,1)} ${text('条/日七日均值','records/day, 7-day mean')}`;
      }
    });
    const monthTicks = rows.map((r,i)=>r.date.slice(8)==='01'?{r,i}:null).filter(Boolean);
    monthTicks.forEach(({r,i})=>{
      const t=svg('text',{x:x0+i*step,y:y0+h+23,'text-anchor':'middle',class:'axis-label'},node); t.textContent=lang==='en'?new Date(`${r.date}T00:00:00Z`).toLocaleString('en',{month:'short'}):`${Number(r.date.slice(5,7))}月`;
    });
    renderCreationEvents();
    const markerSpecs=[
      {key:'private_sharing_product_pages_discovery',date:'2026-07-19',code:'C1',kind:'code'},
      {key:'first_nonempty_source',date:'2026-07-21',code:'M1',kind:'measurement'},
      {key:'first_mcp_label',date:'2026-08-10',code:'M2',kind:'measurement'}
    ];
    markerSpecs.forEach((spec,index)=>{
      const event=(charts.milestones||[]).find(m=>m.key===spec.key);if(!event)return;
      const eventDate=event.at?.slice(0,10)||event.date;if(!eventDate)return;
      const eventIndex=rows.findIndex(r=>r.date===eventDate);if(eventIndex<0)return;
      const x=x0+eventIndex*step+step/2,isCode=spec.kind==='code';
      svg('line',{x1:x,y1:y0,x2:x,y2:y0+h,class:isCode?'code-event-line':'measurement-event-line'},node);
      const markerY=y0+11+(index%2)*22;
      const marker=svg('circle',{cx:x,cy:markerY,r:8,class:isCode?'code-event-mark':'measurement-event-mark'},node);
      const title=svg('title',{},marker);title.textContent=`${eventDate} · ${text(isCode?'代码改动日期；不代表已部署':'测量观察日期；不是产品发布',isCode?'Code-change date; not a deployment claim':'Measurement observation; not a product release')}`;
      const label=svg('text',{x:x+11,y:markerY+4,class:'event-badge-label'},node);label.textContent=spec.code;
    });
    const partial=rows[rows.length-1];
    if(partial?.partial_day){
      const x=x0+(rows.length-1)*step+step/2;
      svg('line',{x1:x,y1:y0,x2:x,y2:y0+h,class:'partial-day-line'},node);
      const label=text(`9/23 · ${fmt(partial.records)} 条 · 截点 23:27`,'Sep 23 · '+fmt(partial.records)+' records · through 23:27');
      const labelWidth=[...label].reduce((width,char)=>width+(char.charCodeAt(0)>255?12:7),20);
      const box=svg('rect',{x:x-labelWidth-4,y:1,width:labelWidth,height:18,rx:2,class:'partial-label-box'},node);
      const title=svg('title',{},box);title.textContent=text('快照时间为 23:27（台北），因此此日未完整；末值七日均线含此日。','Snapshot is at 23:27 Taipei time, so this day is incomplete; the final seven-day mean includes it.');
      const t=svg('text',{x:x-8,y:14,'text-anchor':'end',class:'partial-day-label'},node);t.textContent=label;
    }
    svgAxisTitles(node,x0,y0,w,h,370,text('日期（台北时间）','Date (Taipei time)'),text('创建记录（条／日）','Creation records (per day)'));
    legendInto('creation-legend',[["records",colors.api,text('创建记录','Creation records')],["partial",'repeating-linear-gradient(135deg, #0072B2 0 4px, #FFFFFF 4px 6px)',text('部分日（斜纹）','Partial day (hatched)')],["mean",colors.coral,text('七日均线','7-day mean')]]);
    const tableRows=rows.map(r=>[r.date,fmt(r.records),r.partial_day?text('部分日','Partial'):text('完整日','Complete'),r.trailing_7_day_mean==null?'—':fmt(r.trailing_7_day_mean,1)]);
    dataTable('creation-data',text('逐日创建及七日均线','Daily creations and rolling mean'),[text('日期','Date'),text('记录','Records'),text('日类型','Day'),text('七日均线','7-day mean')],tableRows);
  }
  function renderCreationEvents(){
    const milestones=charts.milestones||[];
    const before=clear('creation-before-events');
    if(before){
      const beforeWindow=milestones.filter(m=>m.type==='code_change'&&(m.at||'').slice(0,10)<'2026-07-01');
      const groups=new Map();beforeWindow.forEach(m=>{const date=m.at.slice(0,10);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(m);});
      [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([date,items])=>{
        const event=el('div',{class:'creation-event-item'});event.append(el('time',{text:date.slice(5).replace('-','/')}));
        const details=items.map(item=>(eventDetails[item.key]||[item.key,item.key])[lang==='en'?1:0]).join(text('；','; '));
        event.append(el('p',{text:details}));before.append(event);
      });
    }
    const key=clear('creation-event-key');if(!key)return;
    const groups=[
      {label:text('代码日期（提交记录，不证明上线）','Code dates (commit history; release not confirmed)'),items:[
        ['C1','2026-07-19',text('私密分享、产品页与发现信息、remote MCP 迁至 workers.dev。','Private sharing, product/discovery pages, and remote MCP moved to workers.dev.')]
      ]},
      {label:text('测量观察（不是产品发布）','Measurement observations (not product releases)'),items:[
        ['M1','2026-07-21',eventDetails.first_nonempty_source[lang==='en'?1:0]],
        ['M2','2026-08-10',eventDetails.first_mcp_label[lang==='en'?1:0]]
      ]},
      {label:text('部署观测（未映射到具体提交）','Deployment observation (not mapped to commits)'),items:[
        ['D1','2026-07-19',text('另有 10:15–12:44（台北时间）的生产部署观测窗口；没有证据把窗口对应到 C1 中的任一代码改动。','A production deployment-observation window was recorded from 10:15–12:44 Taipei time; no evidence maps that window to any code change in C1.')]
      ]}
    ];
    groups.forEach(group=>{
      const section=el('div',{class:'creation-event-group'});section.append(el('strong',{text:group.label}));
      group.items.forEach(([id,date,description])=>{const item=el('p',{class:'creation-event-key-item'});item.append(el('b',{class:`event-id ${id[0]==='M'?'measurement-id':id[0]==='D'?'deployment-id':'code-id'}`,text:id}),document.createTextNode(` ${date.slice(5).replace('-','/')} · ${description}`));section.append(item);});
      key.append(section);
    });
  }
  function renderEqualWindow() {
    const host=clear('equal-window-chart'); if(!host)return;
    const rows=D.equal_23_day_windows||[]; const max=Math.max(...rows.map(x=>x.records),1);
    const titleMonth=text('月份','Month');htmlBarAxes(host,{x:text('创建记录数（条，从 0 起）','Creation records (count, from zero)'),y:titleMonth,max,kind:'bar-axis'});
    rows.forEach(row=>{
      const label=row.window.match(/^(\d{4})-(\d{2})/)?.[2]||'';
      const monthNames=lang==='en'?['July','August','September']:['七月','八月','九月'];
      const idx=Math.max(0,Number(label)-7);
      const wrap=el('div',{class:'bar-row'});wrap.append(el('span',{class:'bar-label',text:monthNames[idx]||row.window}));
      const track=el('div',{class:'bar-track'});track.append(el('div',{class:'bar-fill',style:`width:${100*row.records/max}%`}));
      wrap.append(track,el('strong',{class:'bar-value',text:`${fmt(row.records)} · ${fmt(row.per_day,2)}${text('/日','/day')}` }));host.append(wrap);
    });
    dataTable('equal-window-data',text('每月 1 至 23 日创建记录','Creations on days 1–23 of each month'),[text('窗口','Window'),text('记录','Records'),text('日均','Per day')],rows.map(r=>[r.window,fmt(r.records),fmt(r.per_day,2)]));
  }
  function renderWeeklySource() {
    const rows=charts.creation_weekly||[];const node=setSvg('weekly-source-chart','0 0 1180 365','每周按来源标签拆分的创建记录','Weekly creations by source label');if(!node||!rows.length)return;
    const x0=60,y0=20,w=1090,h=260,max=Math.ceil(Math.max(...rows.map(x=>x.records),1)/50)*50;
    axis(node,x0,y0,w,h,max,[0,max/4,max/2,max*3/4,max],n=>fmt(Math.round(n)));
    const step=w/rows.length,bw=Math.min(54,step*.58),keys=['api','mcp','direct','other','unknown'];
    rows.forEach((r,i)=>{
      let y=y0+h;const x=x0+i*step+(step-bw)/2;
      keys.forEach(k=>{const val=sourceCounts(r)[k]||0;if(!val)return;const hh=val/max*h;y-=hh;const rect=svg('rect',{x,y,width:bw,height:Math.max(.5,hh),fill:sourceColor(k),class:'chart-bar'},node);const title=svg('title',{},rect);title.textContent=`${r.week_start}—${r.week_end}: ${sourceLabel(k)} · ${fmt(val)} ${text('条','records')}`;});
      if(r.complete_days<7){svg('rect',{x:x-1,y:y0+h-(r.records/max*h)-1,width:bw+2,height:r.records/max*h+2,fill:'none',stroke:colors.ochre,'stroke-width':1.3},node);}
      if(i%2===0||i===rows.length-1){const t=svg('text',{x:x0+i*step+step/2,y:y0+h+21,'text-anchor':'middle',class:'axis-label'},node);t.textContent=r.week_start.slice(5);}
      const label=svg('text',{x:x0+i*step+step/2,y:y0+h-(r.records/max*h)-6,'text-anchor':'middle',class:'axis-label'},node);label.textContent=fmt(r.records);
    });
    const note=svg('text',{x:x0+w,y:y0+16,'text-anchor':'end',class:'axis-label'},node);note.textContent=text('末周：3 个观察日，2 个完整日','Final week: 3 observed days, 2 complete');
    svgAxisTitles(node,x0,y0,w,h,365,text('周起始日期（台北时间）','Week start (Taipei time)'),text('创建记录（条／周）','Creation records (per week)'));
    makeLegendSources('weekly-source-legend');
    dataTable('weekly-source-data',text('每周创建记录与来源标签','Weekly creations and source labels'),[text('周起始','Week of'),text('记录','Records'),text('观察日','Observed days'),...keys.map(k=>sourceLabel(k))],rows.map(r=>[r.week_start,fmt(r.records),`${r.observed_days} / 7`,...keys.map(k=>fmt(sourceCounts(r)[k]||0))]));
  }
  function renderMonthlySource() {
    const host=clear('monthly-source-chart');if(!host)return;
    const months=D.source?.by_month||{};const keys=['api','mcp','direct','other','unknown'];
    const axis=el('div',{class:'stacked-axis'});axis.append(el('span',{text:text('Y · 月份','Y · Month')}),el('span',{text:text('X · 当月创建记录占比','X · Share of monthly creations')}),el('span',{text:''}));
    const ticks=el('div',{class:'stacked-axis-ticks'});ticks.append(el('span'),el('div',{class:'ticks'}),el('span'));
    ['0%','50%','100%'].forEach(v=>ticks.querySelector('.ticks').append(el('span',{text:v})));host.append(axis,ticks);
    Object.entries(months).forEach(([month,raw])=>{
      const counts=groupSourceCounts(raw),total=Object.values(counts).reduce((a,b)=>a+b,0);const row=el('div',{class:'stacked-row'});
      row.append(el('strong',{class:'stacked-label',text:month.slice(5)}));const track=el('div',{class:'stacked-track',role:'img','aria-label':`${month}: ${fmt(total)} ${text('条记录','records')}`});
      keys.forEach(k=>{const value=counts[k];if(!value)return;const seg=el('div',{class:'stack-seg',style:`width:${100*value/total}%;background:${sourceColor(k)}`,title:`${sourceLabel(k)}: ${fmt(value)} (${pct(value,total)})`});track.append(seg);});
      row.append(track,el('span',{class:'stacked-note',text:fmt(total)}));host.append(row);
    });
    makeLegendSources('monthly-source-legend');
    dataTable('monthly-source-data',text('按月的来源标签占比','Monthly source-label composition'),[text('月份','Month'),text('记录','Records'),...keys.map(k=>sourceLabel(k))],Object.entries(months).map(([m,v])=>{const c=groupSourceCounts(v);return[m,fmt(Object.values(c).reduce((a,b)=>a+b,0)),...keys.map(k=>`${fmt(c[k])} (${pct(c[k],Object.values(c).reduce((a,b)=>a+b,0))})`)];}));
  }
  function purposeGroups(raw) {
    const all=raw||{};const top=charts.source_purpose_preview_flow?.top_categories||[];
    const result=[];top.forEach(k=>result.push([k,all[k]||0]));
    const unclassified=all['未分类']||0;let other=0;Object.entries(all).forEach(([k,v])=>{if(!top.includes(k)&&k!=='未分类')other+=v;});
    result.push(['其他用途',other],['未分类',unclassified]);return result;
  }
  function renderPurpose() {
    const host=clear('purpose-bars');if(!host)return;
    const month=document.getElementById('purpose-period')?.value||'all';
    const full=D.artifact_classification?.by_category_unique||{};
    const mdata=D.artifact_classification?.by_category_unique_by_creation_month||{};
    const raw=month==='all'?full:(mdata[month]||{});const groups=purposeGroups(raw);const max=Math.max(...groups.map(x=>x[1]),1);const denominator=month==='all'?D.artifact_classification.unique_documents:sum(raw);
    htmlBarAxes(host,{x:text('唯一公开 HTML 数量（个，从 0 起）','Unique public HTML artifacts (count, from zero)'),y:text('规则推定用途','Rule-inferred purpose'),max,kind:'purpose-axis',columns:'minmax(8.5rem,24%) minmax(6rem,1fr) 5rem'});
    groups.forEach(([key,value])=>{
      const row=el('div',{class:`purpose-row${key==='未分类'?' is-unknown':''}`});row.append(el('span',{class:'bar-label',text:categoryLabel(key)}));
      const track=el('div',{class:'bar-track'});track.append(el('div',{class:'bar-fill',style:`width:${100*value/max}%;background:${categoryColors[key]||colors.unknown}`}));
      row.append(track,el('span',{class:'bar-value',text:`${fmt(value)} · ${pct(value,denominator)}`}));host.append(row);
    });
    const rows=groups.map(([key,value])=>[categoryLabel(key),fmt(value),pct(value,month==='all'?D.artifact_classification.unique_documents:sum(raw))]);
    dataTable('purpose-data',text('按用途分类的唯一公开 HTML','Unique public HTML by inferred purpose'),[text('推定用途','Inferred purpose'),text('唯一文件','Unique files'),text('占全部唯一文件','Share of all unique files')],rows);
  }
  function sum(obj){return Object.values(obj||{}).reduce((a,b)=>a+(typeof b==='number'?b:0),0);}
  const flowColors={api:colors.api,mcp:colors.mcp,direct:colors.direct,other:colors.other,unknown:colors.unknown};
  function sankeyPath(x1,y1,x2,y2,thickness){const c=Math.max(45,(x2-x1)*.43),t=thickness/2;return `M ${x1} ${y1-t} C ${x1+c} ${y1-t}, ${x2-c} ${y2-t}, ${x2} ${y2-t} L ${x2} ${y2+t} C ${x2-c} ${y2+t}, ${x1+c} ${y1+t}, ${x1} ${y1+t} Z`;}
  function renderSankey() {
    const f=charts.source_purpose_preview_flow;if(!f)return;const node=setSvg('source-purpose-sankey','0 0 1240 560','创建来源、推定用途与内容访问请求的联合分布','Joint distribution of creation source, inferred purpose, and content-request state');if(!node)return;
    const paths=f.paths||[];const sources=['api','mcp','direct','other','unknown'];const categories=f.nodes.filter(n=>n.stage==='category').map(n=>n.label);const states=['preview_recorded','no_preview_recorded'];
    const total=f.population||paths.reduce((a,p)=>a+p.records,0);const counts={source:{},category:{},state:{}};
    sources.forEach(s=>counts.source[s]=0);categories.forEach(c=>counts.category[c]=0);states.forEach(s=>counts.state[s]=0);
    paths.forEach(p=>{counts.source[p.source]=(counts.source[p.source]||0)+p.records;counts.category[p.category]=(counts.category[p.category]||0)+p.records;counts.state[p.preview]=(counts.state[p.preview]||0)+p.records;});
    const H=485, top=44;const gaps={source:13,category:6,state:30};const scale=Math.min((H-gaps.source*(sources.length-1))/total,(H-gaps.category*(categories.length-1))/total,(H-gaps.state*(states.length-1))/total);
    const layout=(keys,dict,gap)=>{let y=top;const out={};keys.forEach(k=>{const h=(dict[k]||0)*scale;out[k]={y,h,offset:0,total:dict[k]||0};y+=h+gap;});return out;};
    const L=layout(sources,counts.source,gaps.source),M=layout(categories,counts.category,gaps.category),R=layout(states,counts.state,gaps.state);
    const xL=190,xM=610,xR=1005,nodeW=14;
    const orderSource=new Map(sources.map((v,i)=>[v,i])),orderCategory=new Map(categories.map((v,i)=>[v,i])),orderState=new Map(states.map((v,i)=>[v,i]));
    const pairs1=new Map(),pairs2=new Map();
    paths.forEach(p=>{const k1=`${p.source}\u0000${p.category}`,k2=`${p.category}\u0000${p.preview}`;pairs1.set(k1,(pairs1.get(k1)||0)+p.records);pairs2.set(k2,(pairs2.get(k2)||0)+p.records);});
    const edges1=[...pairs1].map(([key,value])=>{const [s,c]=key.split('\u0000');return{s,c,value};}).sort((a,b)=>orderSource.get(a.s)-orderSource.get(b.s)||orderCategory.get(a.c)-orderCategory.get(b.c));
    const edges2=[...pairs2].map(([key,value])=>{const [c,s]=key.split('\u0000');return{c,s,value};}).sort((a,b)=>orderCategory.get(a.c)-orderCategory.get(b.c)||orderState.get(a.s)-orderState.get(b.s));
    const incoming1={};categories.forEach(c=>incoming1[c]=0);edges1.forEach(e=>{e.sy=L[e.s].y+L[e.s].offset+e.value*scale/2;e.ty=M[e.c].y+incoming1[e.c]+e.value*scale/2;L[e.s].offset+=e.value*scale;incoming1[e.c]+=e.value*scale;});
    edges1.forEach(e=>{const p=sankeyPath(xL+nodeW,e.sy,xM,e.ty,e.value*scale);const path=svg('path',{d:p,fill:flowColors[e.s]||colors.unknown,class:'ribbon',tabindex:0},node);const title=svg('title',{},path);title.textContent=`${sourceLabel(e.s)} → ${categoryLabel(e.c)}: ${fmt(e.value)} ${text('条分享记录','share records')}`;path.setAttribute('aria-label',title.textContent);});
    const incoming2={};states.forEach(s=>incoming2[s]=0);edges2.forEach(e=>{e.sy=M[e.c].y+M[e.c].offset+e.value*scale/2;e.ty=R[e.s].y+incoming2[e.s]+e.value*scale/2;M[e.c].offset+=e.value*scale;incoming2[e.s]+=e.value*scale;});
    edges2.forEach(e=>{const p=sankeyPath(xM+nodeW,e.sy,xR,e.ty,e.value*scale);const path=svg('path',{d:p,fill:categoryColors[e.c]||colors.unknown,class:'ribbon',tabindex:0},node);const title=svg('title',{},path);const state=e.s==='preview_recorded'?text('有内容访问请求','Content requests recorded'):text('尚无内容访问请求','No content requests recorded');title.textContent=`${categoryLabel(e.c)} → ${state}: ${fmt(e.value)} ${text('条分享记录','share records')}`;path.setAttribute('aria-label',title.textContent);});
    const columns=[{keys:sources,dict:counts.source,positions:L,x:xL,labelX:15,side:'start',stage:text('来源标签','SOURCE LABEL')},{keys:categories,dict:counts.category,positions:M,x:xM,labelX:xM+24,side:'start',stage:text('推定用途','INFERRED PURPOSE')},{keys:states,dict:counts.state,positions:R,x:xR,labelX:xR+24,side:'start',stage:text('内容访问请求','CONTENT REQUESTS')}];
    columns.forEach((col,ci)=>{
      const head=svg('text',{x:col.x,y:24,class:'axis-label','font-weight':700},node);head.textContent=col.stage;
      col.keys.forEach(k=>{
        const p=col.positions[k];const color=ci===0?(flowColors[k]||colors.unknown):ci===1?(categoryColors[k]||colors.unknown):k==='preview_recorded'?colors.teal:colors.unknown;
        svg('rect',{x:col.x,y:p.y,width:nodeW,height:p.h,fill:color,class:'node'},node);
        let label;if(ci===0)label=sourceLabel(k);else if(ci===1)label=categoryLabel(k);else label=k==='preview_recorded'?text('有请求','Requests recorded'):text('无请求','No requests');
        const t=svg('text',{x:col.labelX,y:p.y+Math.min(14,p.h/2+4),'text-anchor':'start',class:'node-label'},node);t.textContent=`${label} · ${fmt(p.total)}`;
      });
    });
    const chartRows=paths.map(p=>[sourceLabel(p.source),categoryLabel(p.category),p.preview==='preview_recorded'?text('有内容访问请求','Requests recorded'):text('尚无内容访问请求','No requests recorded'),fmt(p.records)]);
    dataTable('flow-data',text('来源、用途与内容访问状态的记录联合分布','Joint records by source, purpose, and content-request state'),[text('来源标签','Source label'),text('推定用途','Inferred purpose'),text('截点内容访问','Content requests at cutoff'),text('记录','Records')],chartRows);
  }
  function renderPurposeTable() {
    const table=clear('purpose-source-table');if(!table)return;const raw=D.artifact_classification?.category_by_self_reported_source_records||{};const flow=charts.source_purpose_preview_flow||{};const top=flow.top_categories||[];
    const keys=[...top,'其他用途','未分类'];const sources=['api','mcp','direct','other','unknown'];const head=document.createElement('thead'),hr=document.createElement('tr');
    [text('规则推定用途','Rule-inferred purpose'),...sources.map(sourceLabel),text('合计','Total')].forEach(v=>hr.append(el('th',{scope:'col',text:v})));head.append(hr);table.append(head);
    const body=document.createElement('tbody');
    keys.forEach(cat=>{const row=el('tr');row.append(el('th',{scope:'row',text:categoryLabel(cat)}));const vals={api:0,mcp:0,direct:0,other:0,unknown:0};
      Object.entries(raw).forEach(([rawCat,sourceObj])=>{if((top.includes(rawCat)&&cat===rawCat)||(!top.includes(rawCat)&&rawCat!=='未分类'&&cat==='其他用途')||(rawCat==='未分类'&&cat==='未分类'))Object.assign(vals,addGroups(vals,groupSourceCounts(sourceObj)));});
      const total=Object.values(vals).reduce((a,b)=>a+b,0);sources.forEach(k=>row.append(el('td',{text:fmt(vals[k])})));row.append(el('td',{text:fmt(total)}));body.append(row);
    });table.append(body);
    const footer=el('tfoot');const tr=el('tr');tr.append(el('th',{scope:'row',text:text('总计','Total')}));const all={api:0,mcp:0,direct:0,other:0,unknown:0};keys.forEach(k=>{});
    Object.entries(raw).forEach(([,v])=>{const c=groupSourceCounts(v);Object.keys(all).forEach(k=>all[k]+=c[k]);});sources.forEach(k=>tr.append(el('td',{text:fmt(all[k])})));tr.append(el('td',{text:fmt(Object.values(all).reduce((a,b)=>a+b,0))}));footer.append(tr);table.append(footer);
  }
  function addGroups(target,delta){const sumObj={};Object.keys(target).forEach(k=>sumObj[k]=(target[k]||0)+(delta[k]||0));return sumObj;}
  function renderUseCases() {
    const host=clear('use-cases');if(!host)return;
    const cases=[
      [['研究简报与决策材料','Research briefs and decision notes'],['把结论、证据表格、来源链接与图表放进一个可转发的单页，让读者不用先进入长报告。','A shareable page brings conclusions, evidence tables, source links, and charts together, so readers can scan without opening a long report first.']],
      [['互动游戏与故事','Interactive games and stories'],['样本中可见触屏操作、得分或回合反馈，也有通过选择推进的叙事；内容说明作品用途，不说明作者是谁。','Artifacts include touch controls, scoring or turn feedback, and stories advanced through choices. This describes the artifact, not its creator.']],
      [['教学与练习','Teaching and practice'],['课程说明、数学练习、复习题与即时反馈会放在同一页面，读者可以边读边操作。','Course notes, math exercises, review questions, and immediate feedback appear together so readers can learn by doing.']],
      [['业务小工具','Small business tools'],['计算器、报价与日常记录页面接收输入并整理结果，适合在浏览器里快速打开。','Calculators, quotes, and everyday logs accept input and organize the result for quick browser use.']],
      [['祝福与个人表达','Greetings and personal expression'],['样本里有生日祝福、道歉和心意表达的互动页面，说明分享链接也被用于个人沟通。','Some pages offer birthday wishes, apologies, or personal messages through interaction, showing a personal communication use.']],
      [['介绍页与操作指南','Product explainers and guides'],['服务说明、活动预览、规范和操作步骤被整理成带导航的网页材料；这不代表它们是正式线上产品。','Service explainers, event previews, policies, and instructions become navigable web documents; this does not mean they are deployed products.']]
    ];
    cases.forEach(([head,body])=>{const article=el('article',{class:'case'});article.append(el('h4',{text:head[lang==='en'?1:0]}),el('p',{text:body[lang==='en'?1:0]}));host.append(article);});
  }
  function renderRepeat() {
    const hist=D.exact_duplicates_public?.histogram||{};const entries=Object.entries(hist).sort((a,b)=>Number(a[0])-Number(b[0]));const node=setSvg('repeat-groups-chart','0 0 620 330','精确重复文件组大小分布','Exact duplicate group-size distribution');if(!node)return;
    const x0=54,y0=18,w=540,h=190,max=Math.max(...entries.map(x=>x[1]),1);axis(node,x0,y0,w,h,max,[0,Math.ceil(max/2),max],n=>fmt(n));
    const step=w/entries.length,bw=step*.58;entries.forEach(([size,count],i)=>{const bh=count/max*h,x=x0+i*step+(step-bw)/2,y=y0+h-bh;const r=svg('rect',{x,y,width:bw,height:bh,fill:colors.teal,class:'chart-bar'},node);const title=svg('title',{},r);title.textContent=`${text('每组文件','Files per group')}: ${size}; ${text('重复组','groups')}: ${count}`;const t=svg('text',{x:x0+i*step+step/2,y:y0+h+21,'text-anchor':'middle',class:'axis-label'},node);t.textContent=size;const v=svg('text',{x:x0+i*step+step/2,y:Math.max(y0+12,y-5),'text-anchor':'middle',class:'axis-label'},node);v.textContent=fmt(count);});
    svgAxisTitles(node,x0,y0,w,h,330,text('每组相同链接数（条）','Identical links per group (count)'),text('精确重复组数（组）','Exact duplicate groups (count)'));
    dataTable('repeat-data',text('精确重复内容组大小分布','Exact duplicate group sizes'),[text('每组相同文件数','Files in group'),text('重复组数','Groups')],entries.map(([a,b])=>[a,fmt(b)]));
    const repeat=D.exact_duplicates_public||{};const pattern=D.title_pattern_repeats_public||{};const note=document.getElementById('repeat-concentration');if(note)note.textContent=text(`精确内容：${fmt(repeat.repeated_hash_groups)} 组、${fmt(repeat.rows_in_repeated_groups)} 条链接；重复组外多出 ${fmt(repeat.extra_rows_over_unique)} 条。标题样式：${fmt(pattern.patterns_repeated_2plus)} 个重复样式涉及 ${fmt(pattern.records_in_repeated_patterns)} 条链接，最大样式 ${fmt(pattern.largest_pattern_size)} 条。标题相似并不代表同一文件或用户。`,`Exact bytes: ${fmt(repeat.repeated_hash_groups)} groups cover ${fmt(repeat.rows_in_repeated_groups)} links, or ${fmt(repeat.extra_rows_over_unique)} links beyond one per unique file. Similar title patterns: ${fmt(pattern.patterns_repeated_2plus)} patterns across ${fmt(pattern.records_in_repeated_patterns)} links; the largest has ${fmt(pattern.largest_pattern_size)}. Similar titles do not prove the same file or user.`);
  }
  function renderPrivacy() {
    const host=clear('privacy-month-chart');if(!host)return;const months=D.monthly||{};const max=.06;
    htmlBarAxes(host,{x:text('私密链接比例（%，从 0 起）','Private-link share (%, from zero)'),y:text('创建月份','Creation month'),max,formatter:v=>`${(v*100).toFixed(0)}%`,kind:'privacy-axis',columns:'3.2rem 1fr 4.4rem'});
    Object.entries(months).forEach(([key,v])=>{const row=el('div',{class:'privacy-row'});row.append(el('strong',{text:key.slice(5)}));const track=el('div',{class:'privacy-track'});track.append(el('div',{class:'privacy-fill',style:`width:${100*(v.private_share_rate||0)/max}%`}));row.append(track,el('span',{class:'privacy-detail',text:`${fmt(v.private_link)} / ${fmt(v.records)} · ${pct(v.private_link,v.records)}`}));host.append(row);});
  }
  function renderRequests() {
    const dist=D.views_asof_snapshot?.distribution||{};const keys=['0','1','2-4','5-19','20-99','100+'];const host=clear('preview-distribution');if(!host)return;const max=Math.max(...keys.map(k=>dist[k]||0),1);
    const yTicks=clear('request-y-axis');if(yTicks){[max,Math.round(max/2),0].forEach(value=>yTicks.append(el('span',{text:fmt(value)})));}
    keys.forEach(k=>{const col=el('div',{class:'dist-column'});const box=el('div',{class:'dist-bar-box'});const bar=el('div',{class:'dist-bar',style:`height:${Math.max(2,100*(dist[k]||0)/max)}%`});bar.setAttribute('title',`${k}: ${fmt(dist[k]||0)} ${text('条分享记录','share records')}`);box.append(bar);col.append(box,el('strong',{class:'dist-value',text:fmt(dist[k]||0)}),el('span',{class:'dist-label',text:k}));host.append(col);});
    const stats=clear('preview-summary');if(stats){stats.append(el('strong',{text:fmt(D.views_asof_snapshot?.percentiles?.p50||0)}),el('p',{text:text('中位内容访问请求／分享','median content requests per share')}),el('strong',{text:fmt(D.views_asof_snapshot?.percentiles?.p90||0)}),el('p',{text:text('第 90 百分位','90th percentile')}));}
    dataTable('preview-data',text('截至快照的累计内容访问请求计数分布','Cumulative content-request distribution at snapshot'),[text('每条分享请求数','Requests per share'),text('分享记录','Share records')],keys.map(k=>[k,fmt(dist[k]||0)]));
    const funnel=clear('snapshot-funnel');if(!funnel)return;const rows=charts.snapshot_outcome_funnel?.stages||[];const maxCount=Math.max(...rows.map(x=>x.records),1);
    const labels={created_records:['创建记录','Created records'],active_at_cutoff:['状态标记为 active','Marked active'],active_with_preview_at_cutoff:['状态为 active，且有内容访问请求','Active with content requests']};
    rows.forEach((r,i)=>{const row=el('div',{class:'funnel-stage'});row.append(el('span',{text:(labels[r.key]||[r.key,r.key])[lang==='en'?1:0]}));const track=el('div',{class:'funnel-track'});track.append(el('div',{class:'funnel-fill',style:`width:${100*r.records/maxCount}%`}));row.append(track,el('strong',{text:fmt(r.records)}));funnel.append(row);});
  }
  function renderUsageEvents(){
    const rows=D.usage_time?.daily_events||[];if(!rows.length)return;
    const node=setSvg('usage-events-chart','0 0 1180 535','每日创建与内容访问请求应用事件，台北时间','Daily creation and content-request application events, Taipei time');if(!node)return;
    const x0=68,w=1080,step=w/rows.length;
    const panels=[
      {key:'viewed',title:text('内容访问请求事件','Content-request events'),color:colors.coral,y0:28,h:185,max:Math.ceil(Math.max(...rows.map(r=>r.viewed),1)/100)*100},
      {key:'created',title:text('创建事件','Creation events'),color:colors.api,y0:290,h:155,max:Math.ceil(Math.max(...rows.map(r=>r.created),1)/25)*25}
    ];
    panels.forEach(panel=>{
      const label=svg('text',{x:x0,y:panel.y0-8,class:'panel-title'},node);label.textContent=panel.title;
      axis(node,x0,panel.y0,w,panel.h,panel.max,[0,panel.max/2,panel.max],n=>fmt(Math.round(n)));
      let changeLabel=null;
      const productChangeIndex=rows.findIndex(r=>r.date==='2026-07-19');
      if(productChangeIndex>=0){
        const eventX=x0+productChangeIndex*step+step/2;
        svg('line',{x1:eventX,y1:panel.y0,x2:eventX,y2:panel.y0+panel.h,stroke:'#111820','stroke-width':1.4,'stroke-dasharray':'5 4',opacity:.8},node);
        if(panel.key==='viewed'){
          changeLabel=svg('text',{x:eventX+6,y:panel.y0+14,class:'event-label'},node);
          changeLabel.textContent=text('7/19 · 产品发布','Jul 19 · product release');
        }
      }
      const points=rows.map((r,i)=>`${x0+i*step+step/2},${panel.y0+panel.h-(r[panel.key]/panel.max)*panel.h}`);
      svg('polyline',{points:points.join(' '),fill:'none',stroke:panel.color,'stroke-width':2.4,'stroke-linejoin':'round','stroke-linecap':'round'},node);
      rows.forEach((r,i)=>{
        const cx=x0+i*step+step/2,cy=panel.y0+panel.h-(r[panel.key]/panel.max)*panel.h;
        const mark=svg('circle',{cx,cy,r:r.partial_day?4:2.5,fill:r.partial_day?'#fff':panel.color,stroke:panel.color,'stroke-width':1.5},node);
        const title=svg('title',{},mark);title.textContent=`${r.date}: ${fmt(r[panel.key])} ${text('次事件','events')}${r.partial_day?` · ${text('截至 23:27 台北时间的部分日','partial through 23:27 Taipei time')}`:''}`;
      });
      const partial=rows[rows.length-1];
      if(changeLabel)node.append(changeLabel);
      if(partial?.partial_day){
        const lastY=panel.y0+panel.h-(partial[panel.key]/panel.max)*panel.h;
        const partialLabel=svg('text',{x:x0+w-5,y:Math.max(panel.y0+28,lastY-8),'text-anchor':'end',class:'event-label'},node);
        partialLabel.textContent=text(`9/23 · ${fmt(partial[panel.key])} 次 · 23:27`,`Sep 23 · ${fmt(partial[panel.key])} · 23:27`);
      }
      const axisName=svg('text',{x:16,y:panel.y0+panel.h/2,transform:`rotate(-90 16 ${panel.y0+panel.h/2})`,'text-anchor':'middle',class:'axis-label'},node);axisName.textContent=text('事件（次／日）','Events (per day)');
    });
    const ticks=[0,14,31,45,62,76,rows.length-1];
    [...new Set(ticks)].forEach(i=>{const r=rows[i];if(!r)return;const label=svg('text',{x:x0+i*step+step/2,y:480,'text-anchor':'middle',class:'axis-label'},node);label.textContent=lang==='en'?`${new Date(`${r.date}T00:00:00Z`).toLocaleString('en',{month:'short'})} ${Number(r.date.slice(8))}`:`${Number(r.date.slice(5,7))}/${Number(r.date.slice(8))}`;});
    const xTitle=svg('text',{x:x0+w/2,y:515,'text-anchor':'middle',class:'axis-label'},node);xTitle.textContent=text('日期（台北时间）','Date (Taipei time)');
    legendInto('usage-events-legend',[["created",colors.api,text('创建事件','Creation events')],["viewed",colors.coral,text('内容访问请求事件','Content-request events')]]);
    dataTable('usage-events-data',text('逐日应用事件（无事件的日期为零）','Daily application events (dates without events are zero)'),[text('日期','Date'),text('创建事件','Creation events'),text('内容访问请求事件','Content-request events'),text('授权事件','Access-granted events'),text('举报事件','Reported events'),text('日期完整性','Day coverage')],rows.map(r=>[r.date,fmt(r.created),fmt(r.viewed),fmt(r.access_granted),fmt(r.reported),r.partial_day?text('部分日','Partial'):text('完整日','Complete')]));
    const months=['2026-07','2026-08','2026-09'];
    const eventTotals=months.map(month=>{
      const inWindow=rows.filter(r=>r.date.startsWith(`${month}-`)&&Number(r.date.slice(8))<=23);
      return {month,createdEvents:inWindow.reduce((n,r)=>n+r.created,0),viewedEvents:inWindow.reduce((n,r)=>n+r.viewed,0)};
    });
    const recordTotals=D.equal_23_day_windows||[];
    dataTable('usage-month-data',text('每月 1–23 日等长窗口：事件和创建记录分开统计','Equal day 1–23 windows: events and creation records shown separately'),[text('窗口','Window'),text('创建事件（次）','Creation events (count)'),text('创建分享记录（条）','Created share records (count)'),text('内容访问请求事件（次）','Content-request events (count)')],eventTotals.map(row=>{
      const snapshot=recordTotals.find(item=>item.window?.startsWith(row.month));
      return [row.month,fmt(row.createdEvents),fmt(snapshot?.records||0),fmt(row.viewedEvents)];
    }));
  }
  function renderFirstRequestDelay(){
    const rows=D.usage_time?.first_request_delay||[];if(!rows.length)return;
    const order=['under_1m','1m_to_1h','1h_to_24h','1d_to_7d','none'];
    const labels={under_1m:['1 分钟内','Under 1 minute'],'1m_to_1h':['1 分钟–1 小时','1 minute–1 hour'],'1h_to_24h':['1–24 小时','1–24 hours'],'1d_to_7d':['1–7 天','1–7 days'],none:['没有内容访问请求','No content request recorded']};
    const lookup=Object.fromEntries(rows.map(r=>[r.bucket,r.records]));
    dataTable('first-request-delay-data',text('分享创建后首次内容访问请求的延迟','Delay to first content request after creation'),[text('首次请求延迟','First-request delay'),text('分享记录（条）','Share records (count)'),text('占全部记录','Share of all records')],order.map(key=>[labels[key][lang==='en'?1:0],fmt(lookup[key]||0),pct(lookup[key]||0,2797)]));
  }
  function renderMatureCohorts(){
    const host=clear('mature-cohort-chart');if(!host)return;
    const follow=D.usage_time?.cohort_followup||[],maturity=D.usage_maturity?.mature_cohorts||[];
    const sourceRows=['api','mcp'].map(source=>{
      const f=follow.find(r=>r.month==='2026-09'&&r.source===source);const m=maturity.find(r=>r.month==='2026-09'&&r.source===source);
      return f&&m?{source,eligible:f.eligible_7d,within:f.requested_within_7d,days2to7:m.requested_days2to7}:null;
    }).filter(Boolean);
    const max=100;const columns='minmax(7rem,30%) minmax(0,1fr) 7.5rem';
    const axisTitle=el('div',{class:'maturity-axis-title'});axisTitle.style.gridTemplateColumns=columns;axisTitle.append(el('span',{text:text('Y · 指标（按来源分组）','Y · Metric (grouped by source)')}),el('span',{text:text('X · 成熟记录占比（%，0–100）','X · Mature records (%)') } ),el('span'));host.append(axisTitle);
    const ticks=el('div',{class:'maturity-axis-ticks'});ticks.style.gridTemplateColumns=columns;const tickline=el('div',{class:'ticks'});[0,50,100].forEach(n=>tickline.append(el('span',{text:`${n}%`})));ticks.append(el('span'),tickline,el('span'));host.append(ticks);
    sourceRows.forEach(row=>{
      const wrap=el('div',{class:'maturity-group'});
      const heading=el('div',{class:'maturity-source-row'});heading.append(el('strong',{class:'maturity-source',text:sourceLabel(row.source)}),el('span',{class:'maturity-denom',text:`n=${fmt(row.eligible)}`}));wrap.append(heading);
      const tracks=el('div',{class:'maturity-tracks'});
      const measures=[
        {key:'within',value:row.within,label:text('7 日内至少一次请求','Any request in 7 days'),color:colors.api},
        {key:'days2to7',value:row.days2to7,label:text('第 2–7 日有请求','Request on days 2–7'),color:colors.coral}
      ];
      measures.forEach(metric=>{
        const line=el('div',{class:'maturity-measure'});line.style.gridTemplateColumns=columns;line.append(el('span',{class:'maturity-measure-label',text:metric.label}));
        const track=el('div',{class:'maturity-track'});const rate=100*metric.value/row.eligible;track.append(el('div',{class:'maturity-fill',style:`width:${Math.min(max,rate)}%;background:${metric.color}`}));
        line.append(track,el('strong',{class:'maturity-value',text:`${fmt(metric.value)}/${fmt(row.eligible)} · ${pct(metric.value,row.eligible)}`}));tracks.append(line);
      });
      wrap.append(tracks);host.append(wrap);
    });
    legendInto('maturity-legend',[["seven-day",colors.api,text('7 日内至少一次请求','Any request in 7 days')],["days-two-seven",colors.coral,text('第 2–7 日有请求','Request on days 2–7')]]);
    dataTable('mature-cohort-data',text('9 月成熟来源队列的固定观察窗','Fixed follow-up windows for mature September source cohorts'),[text('来源标签','Source label'),text('7 日成熟记录','Eligible at 7 days'),text('7 日内有请求','Requested within 7 days'),text('第 2–7 日有请求','Requested on days 2–7')],sourceRows.map(r=>[sourceLabel(r.source),fmt(r.eligible),`${fmt(r.within)} · ${pct(r.within,r.eligible)}`,`${fmt(r.days2to7)} · ${pct(r.days2to7,r.eligible)}`]));
  }
  function renderRUM(){
    const acquisition=D.acquisition_rum;if(!acquisition)return;
    const pageHost=clear('rum-page-chart'),refHost=clear('rum-referrer-chart');if(!pageHost||!refHost)return;
    const rows=acquisition.page_monthly.filter(r=>r.month==='2026-08'||r.month==='2026-09');
    const names={home:['首页','Homepage'],marketing:['产品介绍页','Product pages'],share_wrapper:['分享页外壳','Share-page wrapper'],content:['分享 HTML 内容','Shared HTML content']};
    const sums=Object.fromEntries(Object.keys(names).map(k=>[k,{estimated_pageloads:0,estimated_visits:0}]));
    rows.forEach(r=>{sums[r.category].estimated_pageloads+=r.estimated_pageloads;sums[r.category].estimated_visits+=r.estimated_visits;});
    const max=300,columns='minmax(7rem,30%) minmax(4rem,1fr) 4rem';
    const addAxis=(host,yLabel,xLabel,cls,maxValue=max)=>{const title=el('div',{class:`${cls}-axis-title`});title.style.gridTemplateColumns=columns;title.append(el('span',{text:`Y · ${yLabel}`} ),el('span',{text:`X · ${xLabel}`} ),el('span'));host.append(title);const tickrow=el('div',{class:`${cls}-axis-ticks`});tickrow.style.gridTemplateColumns=columns;const ticks=el('div',{class:'ticks'});[0,maxValue/2,maxValue].forEach(x=>ticks.append(el('span',{text:fmt(x)})));tickrow.append(el('span'),ticks,el('span'));host.append(tickrow);};
    addAxis(pageHost,text('页面组','Page group'),text('估算次数（次）','Estimated count'), 'rum');
    Object.entries(sums).forEach(([key,value])=>{
      const row=el('div',{class:'rum-row'});row.style.gridTemplateColumns=columns;row.append(el('span',{class:'rum-label',text:names[key][lang==='en'?1:0]}));
      const pair=el('div',{class:'rum-pair'});
      [["pageloads",value.estimated_pageloads,colors.api],["visits",value.estimated_visits,colors.coral]].forEach(([kind,count,color])=>{const track=el('div',{class:'rum-track'});track.append(el('div',{class:'rum-fill',style:`width:${100*count/max}%;background:${color}`}));pair.append(track);});
      row.append(pair,el('strong',{class:'rum-value',text:`${fmt(value.estimated_pageloads)}/${fmt(value.estimated_visits)}`}));pageHost.append(row);
    });
    pageHost.append(el('div',{class:'rum-axis-caption',text:text('数值依序为页面加载估算／visit 估算；八月仅首页有抽样，七月没有返回样本，均不代表零流量。','Values show page-load estimate / visit estimate. August has samples for the homepage only; July returned no samples, which does not mean zero traffic.') }));
    dataTable('rum-page-data',text('按页面组汇总的 RUM 抽样估算','RUM sampled estimates by page group'),[text('页面组','Page group'),text('页面加载估算','Page-load estimate'),text('Visit 估算','Visit estimate')],Object.entries(sums).map(([key,v])=>[names[key][lang==='en'?1:0],fmt(v.estimated_pageloads),fmt(v.estimated_visits)]));
    const refBuckets={unattributed_or_unknown:{loads:0,visits:0},instagram:{loads:0,visits:0},gmail_app:{loads:0,visits:0},internal:{loads:0,visits:0}};
    acquisition.referrers.forEach(r=>{const b=refBuckets[r.source];b.loads+=r.estimated_pageloads;b.visits+=r.estimated_visits;});
    const refLabels={unattributed_or_unknown:['空 referrer（直接或未知）','Blank referrer (direct or unknown)'],instagram:['Instagram','Instagram'],gmail_app:['Gmail 应用','Gmail app'],internal:['站内来源','Internal referrer']};
    const refMax=550;addAxis(refHost,text('来源组','Referrer group'),text('估算 visit（次）','Estimated visits'),'rum',refMax);
    Object.entries(refBuckets).forEach(([key,value])=>{
      const row=el('div',{class:'rum-row'});row.style.gridTemplateColumns=columns;row.append(el('span',{class:'rum-label',text:refLabels[key][lang==='en'?1:0]}));
      const track=el('div',{class:'rum-track'});track.append(el('div',{class:'rum-fill',style:`width:${100*value.visits/refMax}%;background:${key==='unattributed_or_unknown'?'#6B7280':key==='internal'?'#FFFFFF':colors.olive};border:${key==='internal'?'1px solid #111820':'none'}`}));
      row.append(track,el('strong',{class:'rum-value',text:key==='internal'?`${fmt(value.loads)} ${text('加载／','loads / ')}${fmt(value.visits)} ${text('visit','visits')}`:fmt(value.visits)}));refHost.append(row);
    });
    refHost.append(el('div',{class:'rum-axis-caption',text:text('估算 visit 合计 550；Cloudflare RUM bot_flag=1 为 170、=0 为 380。flag=0 不证明是真人，flag=1 也不等同边缘已验证机器人类别。','Estimated visits total 550; Cloudflare RUM bot_flag=1 is 170 and flag=0 is 380. A zero flag does not prove a human; flag 1 is not the edge verified-bot class.') }));
    dataTable('rum-referrer-data',text('按安全归类汇总的估算来源','Estimated referrals in safe aggregated groups'),[text('来源组','Referrer group'),text('页面加载估算','Page-load estimate'),text('Visit 估算','Visit estimate')],Object.entries(refBuckets).map(([key,v])=>[refLabels[key][lang==='en'?1:0],fmt(v.loads),fmt(v.visits)]));
    legendInto('rum-page-legend',[["loads",colors.api,text('页面加载估算','Page-load estimate')],["visits",colors.coral,text('Visit 估算','Visit estimate')]]);
  }
  function renderImpact(){
    const impact=D.impact_findings;if(!impact)return;
    const host=clear('impact-source-chart');if(!host)return;
    const sourceLabelsForImpact={api:['API 标签','API label'],mcp:['MCP 标签','MCP label'],direct:['网页入口标签','Web UI label'],other:['其他／缺失标签净额','Net other / missing labels']};
    const rows=(impact.aug_sep_equal_window.sources||[]).filter(r=>['api','mcp','direct','other'].includes(r.source));const max=1700;
    htmlBarAxes(host,{x:text('净增创建记录（条，从 0 起）','Net increase in creation records (count, from zero)'),y:text('调用方来源标签','Caller-supplied source label'),max,kind:'impact-axis',columns:'minmax(9rem,30%) 1fr 6rem'});
    rows.forEach(r=>{const label=sourceLabelsForImpact[r.source][lang==='en'?1:0];const row=el('div',{class:'impact-source-row'});row.style.gridTemplateColumns='minmax(9rem,30%) 1fr 6rem';row.append(el('span',{class:'bar-label',text:label}));const track=el('div',{class:'bar-track'});track.append(el('div',{class:'bar-fill',style:`width:${100*Math.max(0,r.delta)/max}%;background:${sourceColor(r.source)}`}));row.append(track,el('strong',{class:'bar-value',text:`${r.delta>0?'+':''}${fmt(r.delta)} · ${pct(r.delta,1628)}`}));host.append(row);});
    dataTable('impact-source-data',text('8/1–23 与 9/1–23 来源标签的记录变化','Creation-record changes by source label, Aug 1–23 vs Sep 1–23'),[text('创建标签','Creation label'),text('八月','August'),text('九月','September'),text('净变化','Net change'),text('占净增比例','Share of net increase')],rows.map(r=>[sourceLabelsForImpact[r.source][lang==='en'?1:0],fmt(r.august),fmt(r.september),`${r.delta>0?'+':''}${fmt(r.delta)}`,pct(r.delta,1628)]));
  }
  function renderImpactEvidence(){
    const host=clear('evidence-chains');if(!host)return;
    const impact=D.impact_findings,top=D.content_value?.top5;
    const api=impact?.source_outcomes?.find(r=>r.source==='api'),mcp=impact?.source_outcomes?.find(r=>r.source==='mcp');
    const mcp7=(D.usage_time?.cohort_followup||[]).find(r=>r.month==='2026-09'&&r.source==='mcp');
    const api7=(D.usage_time?.cohort_followup||[]).find(r=>r.month==='2026-09'&&r.source==='api');
    const cards=[
      {
        title:text('判断 1 · 创建增量偏向 API 集成入口','Finding 1 · Creation growth is concentrated in API paths'),
        evidence:text(`等长 23 日窗口净增 ${fmt(impact.aug_sep_equal_window.net_additional_records)} 条，其中 API 标签 +${fmt(impact.aug_sep_equal_window.sources.find(r=>r.source==='api')?.delta||0)} 条（${pct(impact.aug_sep_equal_window.sources.find(r=>r.source==='api')?.delta||0,impact.aug_sep_equal_window.net_additional_records)}）。作者自述没有做过推广。`,`Across equal 23-day windows, ${fmt(impact.aug_sep_equal_window.net_additional_records)} records were added; API labels contributed +${fmt(impact.aug_sep_equal_window.sources.find(r=>r.source==='api')?.delta||0)} (${pct(impact.aug_sep_equal_window.sources.find(r=>r.source==='api')?.delta||0,impact.aug_sep_equal_window.net_additional_records)}). The owner reports no promotion.`),
        action:text('先改善 API 创建成功率、错误说明与示例；把外部集成来源改为服务端可验证事件。','First improve API creation success, error guidance, and examples; capture integration source with server-verifiable events.'),
        confidence:text('入口标签与记录增量可信；外部获客归因仍弱。','Strong for source-label mix; weak for external acquisition attribution.')
      },
      {
        title:text('判断 2 · 高访问头部作品与教育或课堂活动相关','Finding 2 · The most-requested artifacts relate to education or classroom activities'),
        evidence:text(`请求量前五是 5 个不同公开文件，共 ${fmt(top?.content_requests||0)} 次（${pct(top?.content_requests||0,top?.cohort_content_requests||1)}）。人工检查均与教育或课堂活动相关；现有规则把五个都留在未分类。`,`The top five by request volume are five distinct public files with ${fmt(top?.content_requests||0)} requests (${pct(top?.content_requests||0,top?.cohort_content_requests||1)}). Manual review found that all relate to education or classroom activities; the current classifier left all five unclassified.`),
        action:text('可优先验证课堂互动、练习反馈和移动分享体验；把头部案例当研究线索，不当全体市场比例。','Prioritize validating classroom interactions, practice feedback, and mobile sharing. Treat head cases as research leads, not market prevalence.'),
        confidence:text('真实文件内容支持用途判断；按访问量目的抽样会放大头部，不能推断典型用户。','Artifact contents support the use-case reading; request-ranked sampling overweights the head and cannot define a typical user.')
      },
      {
        title:text('判断 3 · MCP 创建多，内容访问事件少','Finding 3 · MCP creates many records but few content-request events'),
        evidence:text(`全期 MCP 标签 ${fmt(mcp?.records||0)} 条记录中 ${fmt(mcp?.with_content_requests||0)} 条有内容访问请求；成熟 7 日的 9 月记录为 ${fmt(mcp7?.requested_within_7d||0)}/${fmt(mcp7?.eligible_7d||0)}。API 对应 ${fmt(api7?.requested_within_7d||0)}/${fmt(api7?.eligible_7d||0)}。`,`Across the full period, ${fmt(mcp?.with_content_requests||0)} of ${fmt(mcp?.records||0)} MCP-labeled records had a content request. For mature September links, the seven-day rate is ${fmt(mcp7?.requested_within_7d||0)}/${fmt(mcp7?.eligible_7d||0)}, versus ${fmt(api7?.requested_within_7d||0)}/${fmt(api7?.eligible_7d||0)} for API.`),
        action:text('分别记录工具调用、创建成功、分享发布和内容请求；先验证 MCP 是批量生成、预览还是分享链路。','Track tool calls, successful creation, publication, and content requests separately; validate whether MCP is used for batch generation, preview, or sharing.'),
        confidence:text('创建记录与请求事件分母清楚；事件不代表读者或留存，且 MCP 标签不是特定产品身份。','Event denominators are clear; events are not readers or retention, and an MCP label does not identify a specific product.')
      },
      {
        title:text('判断 4 · 发现端机器观测上升，但不能归因','Finding 4 · Machine-classified observations rose, but attribution is unresolved'),
        evidence:text('7/19 前后两个 14 日窗中，创建记录 25→5；主站 verified-bot 存储观测 71→450，旧 AI-UA 子集 70→395。变化在时间上并行，统计口径与时区不同。','Across the two 14-day windows around Jul 19, creations changed 25→5; main-host verified-bot stored observations rose 71→450 and the legacy AI-UA subset 70→395. These parallel changes use different scopes and timezones.'),
        action:text('为 Search Console、外部 referral、remote MCP 和 WebMCP 分别保存带时间的结果事件，再做按发布分批的验证。','Capture timestamped outcomes separately for Search Console, browser referrals, remote MCP, and WebMCP, then evaluate changes by release cohort.'),
        confidence:text('上线映射已核实，边缘观测仍未加权；结论仅限“观测到同步变化”，因果置信度低。','Release mapping is verified, but edge observations are unweighted; confidence is limited to co-occurrence, not causality.')
      }
    ];
    cards.forEach(item=>{const card=el('article',{class:'evidence-chain'});card.append(el('h3',{text:item.title}),el('p',{class:'evidence-evidence'}));card.lastChild.append(el('strong',{text:text('证据：','Evidence: ')}),document.createTextNode(item.evidence));const action=el('p');action.append(el('strong',{text:text('建议：','Action: ')}),document.createTextNode(item.action));const confidence=el('p',{class:'confidence-line'});confidence.append(el('strong',{text:text('可信度：','Confidence: ')}),document.createTextNode(item.confidence));card.append(action,confidence);host.append(card);});
    renderMilestoneEvidenceTables();
  }
  function renderMilestoneEvidenceTables(){
    const host=clear('impact-evidence-tables');if(!host)return;
    const impact=D.impact_findings||{};const outcomes=impact.source_outcomes||[];
    const sourceNames={api:text('API 标签','API label'),mcp:text('MCP 标签','MCP label'),direct:text('网页入口标签','Web UI label')};
    const sourceRows=outcomes.map(row=>[sourceNames[row.source]||row.source,fmt(row.records),`${fmt(row.with_content_requests)} · ${pct(row.with_content_requests,row.records)}`,fmt(row.content_requests)]);
    const beforeAfter=impact.before_after_july19||[];
    const dateRows=beforeAfter.map(row=>[
      `${row.from}–${row.to}`,
      fmt(row.creation_records),
      `${fmt(row.edge_base_observations)} · ${fmt(row.edge_classes.verified_bot)}`,
      fmt(row.ai_subset_overlapping),
    ]);
    const groupRows=(impact.group_concentration||[]).filter(row=>row.source==='api'||row.source==='mcp').map(row=>[
      sourceNames[row.source],
      row.group_kind==='network_group'?text('网络出口特征分组','Network-egress characteristic group'):text('客户端特征分组','Client-characteristic group'),
      fmt(row.september_records),fmt(row.september_largest_group_records),fmt(row.september_top5_group_records),
    ]);
    const purposeNames={'学习与教学':text('学习与教学','Learning & teaching'),'游戏与互动叙事':text('游戏与互动叙事','Games & interactive stories'),'报告与研究':text('报告与研究','Reports & research')};
    const purposeRows=(D.content_value?.purpose_outcomes||[]).map(row=>[purposeNames[row.category]||row.category,fmt(row.requested_links),fmt(row.links),pct(row.requested_links,row.links)]);
    const useLabels={
      '互动课堂知识测验':text('互动课堂知识测验','Interactive classroom quiz'),
      '互动课堂知识测验（另一主题）':text('互动课堂知识测验（另一主题）','Interactive classroom quiz (another topic)'),
      '可填写与导出/分享的感谢卡工具':text('可填写与导出／分享的感谢卡工具','Fillable greeting-card tool with export/sharing'),
      '通过编号查询学习结果的页面':text('按编号查询学习结果的页面','Learning-results lookup by ID'),
      '带计时与即时反馈的语言练习':text('带计时与即时反馈的语言练习','Timed language practice with immediate feedback')
    };
    const languageLabels={
      '印度尼西亚语':text('印度尼西亚语','Indonesian'),
      '阿拉伯语':text('阿拉伯语','Arabic'),
      '印地语与英语混合':text('印地语与英语混合','Hindi and English'),
      '英语':text('英语','English')
    };
    const cases=(D.content_value?.top5?.anonymous_cases||[]).map(row=>[useLabels[row.broad_use]||text('经人工检查的作品','Manually reviewed artifact'),languageLabels[row.content_language]||text('其他或混合语言','Other or mixed language')]);
    const section=(title,headers,rows,note='')=>{
      const wrapper=el('section',{class:'impact-detail-table'});wrapper.append(el('h4',{text:title}));
      const holder=el('div');wrapper.append(holder);host.append(wrapper);
      const tableId=`impact-table-${host.children.length}`;holder.id=tableId;dataTable(tableId,title,headers,rows);
      if(note)wrapper.append(el('p',{class:'fineprint',text:note}));
    };
    section(text('全期来源标签与累计请求结果','Full-period source labels and cumulative request outcomes'),[text('创建来源标签','Creation source label'),text('创建记录','Creation records'),text('有内容请求的记录 · 比例','Records with requests · rate'),text('内容访问请求事件','Content-request events')],sourceRows,text('每条创建记录的累计计数截至冻结截点；可能包含重复、自测或自动化请求，不代表读者。','Per-record cumulative counter at cutoff; may include repeats, self-checks, or automation, not readers.'));
    section(text('7 月 19 日前后两个 14 日观察窗','Two 14-day windows around July 19'),[text('窗口（Taipei）','Window (Taipei)'),text('创建记录','Creations'),text('边缘基本观测 · 已验证机器人类','Edge base observations · verified-bot class'),text('旧 AI UA 重叠子集','Legacy AI-UA overlapping subset')],dateRows,text('边缘日期使用 UTC；样本未加权，AI UA 是基本总量的重叠子集。','Edge dates use UTC; observations are unweighted and AI-UA overlaps the base total.'));
    section(text('九月按来源标签的分组集中度（仅聚合）','September grouping concentration by source label (aggregated only)'),[text('来源标签','Source label'),text('分组含义','Grouping type'),text('该标签记录','Records for label'),text('最大分组记录数','Largest group'),text('前五组记录数','Top five groups')],groupRows,text('仅比较分组大小，不公开分组键；网络出口与客户端特征分组都不等于人或组织。','Only group sizes are shown; no group key is published. Network/client characteristics do not equal people or organizations.'));
    section(text('用途类别中有过内容请求的记录比例','Share records with requests by inferred purpose'),[text('作品用途规则标签','Inferred purpose label'),text('有请求记录','Records with requests'),text('公开分享记录','Public share records'),text('比例','Rate')],purposeRows,text('单标签规则用途；分母为活跃公开分享记录，不是唯一用户。','Single-label rule inference; denominator is active public share records, not users.'));
    section(text('人工检查的高请求前五（广义改写）','Manual review of the five highest-request artifacts (broad paraphrases)'),[text('广义用途','Broad use'),text('内容文本语言信号','Language cue in content')],cases,text('按请求量目的抽样；不展示标题或逐项请求数，不用于估算整体用途比例。','Purposive sample ranked by request count; titles and per-artifact counts are omitted. It does not estimate overall purpose prevalence.'));
  }
  function renderEdge() {
    const rows=charts.edge_daily||[];if(!rows.length)return;
    const classes=[['human','unmatched_or_legacy_human_label',colors.edgeFallback,['未匹配／旧回退','Unmatched / legacy fallback']],['unverified_bot',null,colors.unverified,['未验证机器人规则','Unverified-bot heuristic']],['verified_bot',null,colors.verified,['已验证机器人类别','Verified-bot class']]];
    const base=setSvg('edge-base-chart','0 0 1180 330','Cloudflare 主站每日边缘观测基本类别','Daily base classes in main-host Cloudflare observations');
    const ai=setSvg('edge-ai-chart','0 0 1180 270','旧版 AI user-agent 每日观测，重叠子集','Daily legacy AI user-agent observations, overlapping subset');
    const x0=55,w=1090,step=w/rows.length,bw=Math.max(2,step*.7);
    if(base){const max=Math.ceil(Math.max(...rows.filter(x=>x.base_observations!=null).map(x=>x.base_observations),1)/100)*100;axis(base,x0,20,w,190,max,[0,max/2,max],n=>fmt(Math.round(n)));rows.forEach((r,i)=>{if(r.base_observations==null)return;let y=210,x=x0+i*step+(step-bw)/2;classes.forEach(([key,legacy,color,label])=>{const val=legacy?r.classes?.[key]:(key==='human'?r.classes?.[key]:r.classes?.[key]);if(!val)return;const h=val/max*190;y-=h;const rect=svg('rect',{x,y,width:bw,height:Math.max(.5,h),fill:color},base);const t=svg('title',{},rect);t.textContent=`${r.date} · ${label[lang==='en'?1:0]} · ${fmt(val)}`;});});
      const gap=rows.findIndex(r=>r.base_observations==null);if(gap>=0){const gx=x0+gap*step+step/2;svg('line',{x1:gx,y1:20,x2:gx,y2:210,stroke:colors.coral,'stroke-width':2,'stroke-dasharray':'4 4'},base);const t=svg('text',{x:gx+5,y:34,class:'axis-label'},base);t.textContent=text('8/25 缺日','Aug 25 missing');}
      [0,30,60,90,111].forEach(i=>{const r=rows[Math.min(i,rows.length-1)];const t=svg('text',{x:x0+i*step,y:231,class:'axis-label','text-anchor':i===0?'start':'middle'},base);t.textContent=r.date.slice(5);});svgAxisTitles(base,x0,20,w,190,310,text('日期（UTC）','Date (UTC)'),text('存储观测（条／日）','Stored observations (per day)'));
    }
    if(ai){const vals=rows.map(x=>x.ai_subset_overlapping||0),max=Math.ceil(Math.max(...vals,1)/25)*25;axis(ai,x0,18,w,145,max,[0,max/2,max],n=>fmt(Math.round(n)));rows.forEach((r,i)=>{if(r.base_observations==null)return;const val=r.ai_subset_overlapping||0;if(!val)return;const h=val/max*145,x=x0+i*step+(step-bw)/2,y=163-h;const rect=svg('rect',{x,y,width:bw,height:h,fill:colors.ai},ai);const t=svg('title',{},rect);t.textContent=`${r.date}: ${fmt(val)} ${text('条重叠观测','overlapping observations')}`;});const gap=rows.findIndex(r=>r.base_observations==null);if(gap>=0){const gx=x0+gap*step+step/2;svg('line',{x1:gx,y1:18,x2:gx,y2:163,stroke:colors.coral,'stroke-width':2,'stroke-dasharray':'4 4'},ai);} [0,30,60,90,111].forEach(i=>{const r=rows[Math.min(i,rows.length-1)];const t=svg('text',{x:x0+i*step,y:184,class:'axis-label','text-anchor':i===0?'start':'middle'},ai);t.textContent=r.date.slice(5);});svgAxisTitles(ai,x0,18,w,145,260,text('日期（UTC）','Date (UTC)'),text('AI UA 子集（条／日）','AI-UA subset (per day)'));}
    legendInto('edge-legend',[[0,colors.edgeFallback,text('未匹配／旧版回退（非已验证人类）','Unmatched / legacy fallback (not verified humans)')],[1,colors.unverified,text('未验证机器人规则','Unverified-bot heuristic')],[2,colors.verified,text('已验证机器人类别','Verified-bot class')],[3,colors.ai,text('旧版 AI UA 子集（重叠）','Legacy AI-UA subset (overlapping)')]]);
    const edge=D.edge_traffic||{};const rowsTable=rows.filter(x=>x.base_observations!=null).map(r=>[r.date,fmt(r.classes?.human||0),fmt(r.classes?.unverified_bot||0),fmt(r.classes?.verified_bot||0),fmt(r.base_observations),fmt(r.ai_subset_overlapping||0)]);
    dataTable('edge-data',text('每日主站边缘观测，缺失日期留空','Daily main-host edge observations, missing date omitted'),[text('日期 UTC','Date UTC'),text('未匹配／旧回退','Unmatched / fallback'),text('未验证机器人','Unverified bot'),text('已验证机器人','Verified bot'),text('基本观测合计','Base observations'),text('旧版 AI UA 重叠子集','Legacy AI-UA subset')],rowsTable);
    renderRoutes();renderClaimedBotLabels();
  }
  function egressCountryName(code){
    if(code==='ZZ')return text('未知出口地区','Unknown egress region');
    try{return new Intl.DisplayNames([lang==='en'?'en':'zh-CN'],{type:'region'}).of(code)||code;}catch{return code;}
  }
  function renderCountry(){
    const host=clear('country-bars'), edgeCountry=D.edge_country;
    if(!host)return;
    if(!edgeCountry){host.textContent=text('国家／地区汇总暂未提供。','Country/region aggregates are not available.');return;}
    const period=document.getElementById('country-period')?.value||'all';
    const selected=period==='all'?edgeCountry:(edgeCountry.monthly?.[period]||edgeCountry);
    const rows=[...(selected.countries||[])].sort((a,b)=>b.base_observations-a.base_observations);
    const top=rows.slice(0,10),rest=rows.slice(10);
    const classes=[['human',colors.edgeFallback,['未匹配／旧版回退','Unmatched / legacy fallback']],['unverified_bot',colors.unverified,['未验证机器人规则','Unverified-bot heuristic']],['verified_bot',colors.verified,['已验证机器人类别','Verified-bot class']]];
    legendInto('country-legend',classes.map(([key,color,label])=>[key,color,label[lang==='en'?1:0]]));
    const restRow=rest.length?{country:'__OTHER__',base_observations:sum(rest.map(x=>x.base_observations)),classes:rest.reduce((acc,row)=>{classes.forEach(([key])=>acc[key]=(acc[key]||0)+(row.classes?.[key]||0));return acc;},{})}:null;
    const plotted=restRow?[...top,restRow]:top;const max=Math.max(...plotted.map(x=>x.base_observations),1);
    plotted.forEach(row=>{
      const line=el('div',{class:'country-row',role:'img'});const label=row.country==='__OTHER__'?text('其他地区与未知出口','Other regions and unknown egress'):egressCountryName(row.country);
      line.setAttribute('aria-label',`${label}: ${fmt(row.base_observations)} ${text('条边缘观测','edge observations')}`);line.append(el('span',{class:'country-name',text:label}));
      const track=el('div',{class:'country-track'});classes.forEach(([key,color,caption])=>{const count=row.classes?.[key]||0;if(!count)return;const seg=el('span',{class:'country-segment',style:`width:${100*count/max}% ;background:${color}`});seg.setAttribute('title',`${label} · ${caption[lang==='en'?1:0]}: ${fmt(count)}`);track.append(seg);});
      line.append(track,el('strong',{class:'country-value',text:fmt(row.base_observations)}));host.append(line);
    });
    const axisTitle=el('div',{class:'country-axis-title'});
    axisTitle.append(el('span',{text:text('Y · 请求出口国家／地区','Y · Request egress country / region')}),el('span',{text:text('X · 存储观测（条）','X · Stored observations (count)')}),el('span'));
    const axis=el('div',{class:'country-axis'});axis.append(el('span'),el('div',{class:'ticks'}),el('span'));
    [0,max/2,max].forEach(value=>axis.querySelector('.ticks').append(el('span',{text:fmt(value)})));
    host.append(axisTitle,axis);
    const scope=document.getElementById('country-scope');if(scope){
      if(period==='all')scope.textContent=text(`单位：Cloudflare 主站存储观测 · ${fmt(selected.base_observations)} 条 · ${edgeCountry.from} 至 ${edgeCountry.to} UTC`,`Unit: stored Cloudflare main-host observations · ${fmt(selected.base_observations)} · ${edgeCountry.from} through ${edgeCountry.to} UTC`);
      else {const month=period.slice(5),start=`${period}-01`,end=period==='2026-09'?'2026-09-22':period==='2026-08'?'2026-08-31':'2026-07-31';scope.textContent=text(`单位：Cloudflare 主站存储观测 · ${fmt(selected.base_observations)} 条 · ${start} 至 ${end} UTC`,`Unit: stored Cloudflare main-host observations · ${fmt(selected.base_observations)} · ${start} through ${end} UTC`);}
    }
    const fullRows=rows.map(row=>[egressCountryName(row.country),fmt(row.base_observations),...classes.map(([key])=>fmt(row.classes?.[key]||0)),fmt(row.ai_subset_overlapping||0)]);
    dataTable('country-data',text('请求出口国家／地区及互斥基础分类的全量汇总','All request-egress country/region totals and exclusive base classes'),[text('请求出口国家／地区','Request egress country/region'),text('基本观测','Base observations'),...classes.map(([,c,label])=>label[lang==='en'?1:0]),text('AI UA 重叠子集（不叠加）','AI UA overlapping subset (not added)')],fullRows);
  }
  function renderRoutes(){
    const host=clear('discovery-routes');if(!host)return;const counts=D.edge_traffic?.route_observations_base_classes||{};const routes=Object.entries(counts).sort((a,b)=>b[1]-a[1]);const max=Math.max(...routes.map(x=>x[1]),1);
    htmlBarAxes(host,{x:text('存储观测请求数（条，从 0 起）','Stored request observations (count, from zero)'),y:text('主站路由','Main-host route'),max,kind:'route-axis',columns:'minmax(7rem,42%) 1fr 3.5rem'});
    routes.forEach(([path,n])=>{const row=el('div',{class:'route-row'});row.append(el('span',{class:'route-label',text:path}));const track=el('div',{class:'route-track'});track.append(el('div',{class:'route-fill',style:`width:${100*n/max}%`}));row.append(track,el('strong',{text:fmt(n)}));host.append(row);});
    dataTable('route-data',text('主站路由存储观测','Stored observations by main-host route'),[text('路径','Path'),text('观察请求','Observations')],routes.map(([a,b])=>[a,fmt(b)]));
  }
  function renderClaimedBotLabels(){
    const host=clear('claimed-bots');if(!host)return;const rows=D.edge_traffic?.claimed_bot_labels||[];if(!rows.length){host.textContent=text('未提供安全聚合的声明名称数据。','No safely aggregated claimed-name data was provided.');return;}
    const max=Math.max(...rows.map(x=>x.observations),1);
    htmlBarAxes(host,{x:text('存储观测数（条，从 0 起）','Stored observations (count, from zero)'),y:text('请求头声明名称','Claimed request-header name'),max,kind:'route-axis',columns:'minmax(7rem,42%) 1fr 3.5rem'});
    rows.forEach(r=>{const row=el('div',{class:'route-row'});row.append(el('span',{class:'route-label',text:r.name}));const track=el('div',{class:'route-track'});track.append(el('div',{class:'route-fill',style:`width:${100*r.observations/max}%`}));row.append(track,el('strong',{text:fmt(r.observations)}));host.append(row);});
    dataTable('claimed-bots-data',text('声明名称的边缘观测数','Edge observations by claimed name'),[text('聚合名称','Aggregated name'),text('观测','Observations')],rows.map(r=>[r.name,fmt(r.observations)]));
  }
  function renderEvidence(){
    renderImpactEvidence();
    const ms=charts.milestones||[];const product=ms.filter(x=>x.type==='code_change'||x.type==='deployment_observed');const measure=ms.filter(x=>x.type==='measurement');
    renderTimeline('product-timeline',product,false);renderTimeline('measurement-timeline',measure,true);
    const detail=clear('milestone-evidence');if(detail){const map=[['seo',milestoneEvidence.seo],['geo',milestoneEvidence.geo],['webmcp',milestoneEvidence.webmcp],['remote',milestoneEvidence.remote]];map.forEach(([key,x])=>{const d=el('div',{class:'evidence-detail'});d.append(el('strong',{text:x.title[lang==='en'?1:0]}),el('span',{text:`${x.observed[lang==='en'?1:0]} ${x.missing[lang==='en'?1:0]}`}));detail.append(d);});}
  }
  function renderTimeline(id,rows,isMeasurement){
    const host=clear(id);if(!host)return;
    const releaseRows=D.release_evidence||[];
    rows.sort((a,b)=>timelineDate(a).localeCompare(timelineDate(b))).forEach(r=>{
      const key=r.key;const date=timelineDate(r);const item=el('article',{class:`timeline-item${r.type==='deployment_observed'?' deployment-item':''}`});
      item.append(el('time',{text:date.replace('T',' ').slice(0,16)+(r.timezone==='UTC'?' UTC':isMeasurement?'':' Taipei')}));
      let label=milestoneLabels[key]||[key,key];item.append(el('strong',{text:label[lang==='en'?1:0]}));
      let extra='';if(r.type==='deployment_observed')extra=text(`另有生产部署观测窗口：${r.at.slice(11,16)}–${r.end.slice(11,16)}（台北时间），覆盖时段已记录。`,`A production deployment-observation window was recorded from ${r.at.slice(11,16)}–${r.end.slice(11,16)} Taipei time.`);
      else if(r.type==='code_change'){
        const evidence=releaseRows.find(x=>x.key===key);
        if(evidence?.exact_deployment_at){const local=new Date(evidence.exact_deployment_at).toLocaleString(lang==='en'?'en-US':'zh-CN',{timeZone:'Asia/Taipei',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});extra=text(`已与生产部署记录精确对应：${local}（台北时间）。`,`Exact production-deployment record linked: ${local} Taipei time.`);}
        else if(evidence?.evidence_kind==='ancestor_in_successful_production_build'&&evidence.production_build_at){const local=new Date(evidence.production_build_at).toLocaleString(lang==='en'?'en-US':'zh-CN',{timeZone:'Asia/Taipei',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});extra=text(`代码已出现在 ${local}（台北时间）的成功生产构建中；原始上线时点未恢复。`,`Code is present in a successful production build at ${local} Taipei time; the original deployment instant was not recovered.`);}
        else if(evidence?.production_build_at){const local=new Date(evidence.production_build_at).toLocaleString(lang==='en'?'en-US':'zh-CN',{timeZone:'Asia/Taipei',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});extra=text(`成功生产构建与版本记录：${local}（台北时间）；没有对应的精确部署时点。`,`Successful production build and version recorded at ${local} Taipei time; an exact deployment instant is not linked.`);}
        else extra=text('只有代码提交日期；没有恢复与生产构建或部署的对应证据。','Only the commit date is known; no linked production build or deployment evidence was recovered.');
      }
      item.append(el('span',{text:extra}));host.append(item);
    });
  }
  function timelineDate(r){return r.at||r.date||'';}
  function renderAll(){
    renderDaily();renderEqualWindow();renderWeeklySource();renderMonthlySource();renderPurpose();renderSankey();renderPurposeTable();renderUseCases();renderRepeat();renderPrivacy();renderRequests();renderUsageEvents();renderFirstRequestDelay();renderMatureCohorts();renderRUM();renderEdge();renderCountry();renderImpact();renderEvidence();renderFeatureMethod();
  }
  function renderFeatureMethod(){
    const host=document.getElementById('feature-method');if(!host)return;const f=D.artifact_classification?.feature_document_presence_unique||{};
    host.textContent=text(`静态 HTML 中，${fmt(f.form||0)} 个文件含表单、${fmt(f.canvas||0)} 个含画布、${fmt(f.button||0)} 个含按钮、${fmt(f.script||0)} 个含脚本标签；这只说明文件结构，不保证浏览器运行时行为。`,`Static HTML contains forms in ${fmt(f.form||0)} files, canvas in ${fmt(f.canvas||0)}, buttons in ${fmt(f.button||0)}, and script tags in ${fmt(f.script||0)}. These are file-structure cues, not proof of runtime behavior.`);
  }
  function applyLanguage(next, updateUrl=true){
    lang=next==='en'?'en':'zh';document.documentElement.lang=lang==='en'?'en':'zh-CN';
    document.querySelectorAll('[data-lang]').forEach(node=>{node.hidden=node.getAttribute('data-lang')!==lang;});
    document.querySelectorAll('[data-language-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.languageChoice===lang)));
    const purposeSelect=document.getElementById('purpose-period');if(purposeSelect){purposeSelect.setAttribute('aria-label',text('按创建月份筛选用途','Filter inferred purposes by creation month'));[...purposeSelect.options].forEach((option,i)=>{option.textContent=([['全期','All'],['七月','July'],['八月','August'],['九月','September']][i]||[option.value,option.value])[lang==='en'?1:0];});}
    const countrySelect=document.getElementById('country-period');if(countrySelect){countrySelect.setAttribute('aria-label',text('按时间范围筛选请求出口地区','Filter request egress by time period'));[...countrySelect.options].forEach((option,i)=>{option.textContent=([['全期','Full period'],['七月','July'],['八月','August'],['九月','September']][i]||[option.value,option.value])[lang==='en'?1:0];});}
    const desc=document.querySelector('meta[name="description"]');if(desc)desc.content=lang==='en'?'Share HTML product research for Q3 2026: creation trends, public artifact purposes, and evidence boundaries for SEO, GEO, and WebMCP.':'Share HTML 2026年第三季度产品使用研究：创建趋势、公开 HTML 用途与 SEO、GEO、WebMCP 证据边界。';
    document.title=lang==='en'?'Share HTML usage research · 2026.09':'Share HTML 使用研究 · 2026.09';
    if(updateUrl){const url=new URL(location.href);url.searchParams.set('lang',lang);history.replaceState(null,'',url);}
    renderAll();
  }
  document.querySelectorAll('[data-language-choice]').forEach(button=>button.addEventListener('click',()=>applyLanguage(button.dataset.languageChoice)));
  document.getElementById('purpose-period')?.addEventListener('change',()=>renderPurpose());
  document.getElementById('country-period')?.addEventListener('change',()=>renderCountry());
  function download(name,type,content){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.getElementById('download-json')?.addEventListener('click',()=>download('share-html-report-aggregates-2026-09-23.json','application/json;charset=utf-8',JSON.stringify(D,null,2)));
  document.getElementById('download-csv')?.addEventListener('click',()=>{const rows=[['month','records','public_unlisted','private_link','records_per_day','view_requests_asof'],...Object.entries(D.monthly||{}).map(([month,v])=>[month,v.records,v.public_unlisted,v.private_link,v.records_per_day,v.view_requests_asof])];const csv='\ufeff'+rows.map(row=>row.map(x=>`"${String(x).replaceAll('"','""')}"`).join(',')).join('\r\n');download('share-html-monthly-summary-2026-09-23.csv','text/csv;charset=utf-8',csv);});
  applyLanguage(lang,false);
})();
