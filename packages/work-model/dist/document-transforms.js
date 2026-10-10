var E=`# New slide

Start writing here.`;function D(n,e,i){let t=e||[],r=E;if(i>=t.length)return n.trim()===""?r:`${n}${n.endsWith(`
`)?"":`
`}---
${r}`;let o=t[i]?.range;if(!o)throw new TypeError("Slide insertion needs the target slide range.");let l=o.start;return`${n.slice(0,l)}${r}
---
${n.slice(l)}`}function M(n,e,i){let t=e||[],r=t[i];if(!r||t.length<2)return null;let s=r.range;if(!s)return null;let o,l;if(i===0)o=s.start,l=r.delimiter_range?.end||s.end;else if(i===t.length-1){let u=t[i-1]?.delimiter_range;if(!u)return null;o=u.start,l=s.end}else o=s.start,l=r.delimiter_range?.end||s.end;return`${n.slice(0,o)}${n.slice(l)}`}function W(n,e,i,t){let r=e?.slides||[];if(!r[i]||t<0||t>=r.length)return null;let s=e?.front_matter?.range?.end||0,o=[];for(let g of r){let f=g.range;if(!f)return null;let d=n.slice(f.start,f.end),p=d.match(/\s*$/)?.[0]||"";o.push({body:d.slice(0,d.length-p.length),trailing:p})}let l=[];for(let[g,f]of r.slice(0,-1).entries()){let d=o[g],p=f.delimiter_range;if(!d||!p)return null;l.push(`${d.trailing}${n.slice(p.start,p.end)}`)}let a=o.at(-1);if(!a)return null;let u=a.trailing,m=o.splice(i,1)[0];if(!m)return null;o.splice(t,0,m);let h=o.map((g,f)=>`${g.body}${l[f]||""}`).join("");return`${n.slice(0,s)}${h}${u}`}function x(n,e){if(!e)throw new TypeError("Block operations need a block.");let i=e.range;if(!i)throw new TypeError("Block operations need a block range.");return e.position_scope!=="block"||!e.position_directive_id?i.start:n?.directives?.find(r=>r.id===e.position_directive_id)?.range?.start??i.start}function R(n,e){return(n||[]).slice(e+1).find(i=>i.type==="position_close")}function y(n,e){if(!n||!e)return null;let i=n.range;if(!i)return null;let t=x(e,n),r=i.end;if(n.position_scope==="group"&&(e.blocks||[]).filter(o=>o.position_directive_id===n.position_directive_id).length===1){let o=e.directives||[],l=o.findIndex(m=>m.id===n.position_directive_id),a=l>=0?o[l]:void 0,u=R(o,l);a?.range&&(t=a.range.start),u?.range&&(r=u.range.end)}return{from:t,to:r}}function I(n,e,i){if(!e)return null;let t=e.blocks||[],r=e.range;if(!r)return null;let s=i<t.length?t[i]:void 0;if(i<t.length&&!s)return null;let o=s?x(e,s):r.end;if(i<t.length)return`${n.slice(0,o)}New block

${n.slice(o)}`;let l=n.slice(0,o),a=l.trim()===""?"":l.endsWith(`
`)?`
`:`

`,u=e.delimiter_range?`
`:"";return`${n.slice(0,o)}${a}New block${u}${n.slice(o)}`}function N(n,e,i){if(!e||!i)return null;let t=y(i,e);if(!t)return null;let r=n.slice(0,t.from),s=n.slice(t.to);return(r.trim()===""&&s.startsWith(`
`)||s.startsWith(`
`)&&r.endsWith(`

`))&&(s=s.slice(1)),`${r}${s}`}function L(n,e,i,t){if(!e||t<0||t>=(e.blocks||[]).length)return null;let r=e.blocks||[],s=e.range;if(!s)return null;let o=[];for(let c of r){if(!c.range)return null;o.push({block:c,range:c.range})}let l=r[i],a=l?.position_scope==="group"?l.position_directive_id:null,u=Math.min(i,t),m=Math.max(i,t);if(r.slice(u,m+1).some(c=>c.position_scope==="group"&&c.position_directive_id!==a)||a&&r.slice(u,m+1).some(c=>c.position_scope!=="group"||c.position_directive_id!==a))return null;let h=[],g=[],f=null,d=0;for(let{block:c,range:b}of o){let $=x(e,c),k=n.slice(b.start,b.end).match(/\r\n|\n|\r$/)?.[0]||"",_=b.end-k.length;h.push(n.slice($,_)),f===null?f=$:g.push(n.slice(d,$)),d=_}if(f===null)return null;let p=n.slice(d,s.end),T=n.slice(s.start,f),v=h.splice(i,1)[0];if(v===void 0)return null;h.splice(t,0,v);let S=`${T}${h.map((c,b)=>`${c}${g[b]||""}`).join("")}${p}`;return`${n.slice(0,s.start)}${S}${n.slice(s.end)}`}function O(n){if(!n)return{horizontal:"left",vertical:"top",verticalExplicit:!1};let e=n.trim().split(/\s+/),i="top",t="left";if(e.length===1){let r=e[0]??"";["left","center","right"].includes(r)?t=r:["top","middle","bottom"].includes(r)&&(i=r)}else if(e.length>=2){let r=e[0]??"",s=e[1]??"";i=r==="center"?"middle":r,t=s}return{horizontal:t,vertical:i,verticalExplicit:i!=="top"}}function C(n,e,i){let t=i,r=n.slice(e,t).match(/(?:\r\n|\r|\n)$/)?.[0];if(!r){let s=n.slice(t).match(/^(?:\r\n|\r|\n)/)?.[0];s?(t+=s.length,r=s):r=`
`}return{from:e,to:t,lineEnding:r}}function z(n,e,i){let t=n.match(/\r\n|\r|\n/)?.[0]||`
`,r=`${i}${t}${t}`;return{updated:`${n.slice(0,e)}${r}${n.slice(e)}`,replacement:r,lineEnding:t}}function w(n,e){let i=e.end,t=n.slice(0,e.start);if(!n.slice(e.start,i).match(/(?:\r\n|\r|\n)$/)?.[0]){let o=n.slice(i).match(/^(?:\r\n|\r|\n)/)?.[0];o&&(i+=o.length)}let s=n.slice(i);return t.endsWith(`

`)&&s.startsWith(`
`)&&(s=s.slice(1)),{updated:`${t}${s}`,to:i}}function j(n,e){return[...e].sort((i,t)=>t.start-i.start).reduce((i,t)=>w(i,t).updated,n)}function G(n){let e=[];return{text:n.replace(/\$\{(\d+)(?::([^}]*))?\}/g,(t,r,s="")=>{let o=B(n,e);return e.push({number:Number(r),start:o,length:s.length}),s}),stops:e.sort((t,r)=>t.number===0?1:r.number===0?-1:t.number-r.number)}}function B(n,e){let i=[...n.matchAll(/\$\{\d+(?::[^}]*)?\}/g)],t=i[e.length];return!t||t.index===void 0?n.length:t.index-e.reduce((r,s,o)=>r+(i[o]?.[0].length??0)-s.length,0)}function K(n,e,i){let t=n.slice(0,e.from),r=n.slice(e.to),s=t.length===0||/\n\n$/.test(t)?"":/\n$/.test(t)?`
`:`

`,o=r.length===0||/^\n\n/.test(r)?"":/^\n/.test(r)?`
`:`

`;return`${s}${i}${o}`}export{D as addSlide,y as blockOperationRange,x as blockOperationStart,M as deleteSlide,C as directiveLineSpan,w as exciseRange,j as exciseRanges,G as expandSnippet,R as findPositionCloseAfter,z as insertAlignDirective,I as insertBlock,K as mediaInsertText,L as moveBlock,W as moveSlide,O as parseAlignment,N as removeBlock};
