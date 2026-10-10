var T=`# New slide

Start writing here.`;function _(e,t,i){let n=t||[],r=T;if(i>=n.length)return e.trim()===""?r:`${e}${e.endsWith(`
`)?"":`
`}---
${r}`;let s=n[i]?.range;if(!s)throw new TypeError("Slide insertion needs the target slide range.");let o=s.start;return`${e.slice(0,o)}${r}
---
${e.slice(o)}`}function y(e,t,i){let n=t||[],r=n[i];if(!r||n.length<2)return null;let l=r.range;if(!l)return null;let s,o;if(i===0)s=l.start,o=r.delimiter_range?.end||l.end;else if(i===n.length-1){let c=n[i-1]?.delimiter_range;if(!c)return null;s=c.start,o=l.end}else s=l.start,o=r.delimiter_range?.end||l.end;return`${e.slice(0,s)}${e.slice(o)}`}function B(e,t,i,n){let r=t?.slides||[];if(!r[i]||n<0||n>=r.length)return null;let l=t?.front_matter?.range?.end||0,s=[];for(let d of r){let u=d.range;if(!u)return null;let g=e.slice(u.start,u.end),a=g.match(/\s*$/)?.[0]||"";s.push({body:g.slice(0,g.length-a.length),trailing:a})}let o=[];for(let[d,u]of r.slice(0,-1).entries()){let g=s[d],a=u.delimiter_range;if(!g||!a)return null;o.push(`${g.trailing}${e.slice(a.start,a.end)}`)}let f=s.at(-1);if(!f)return null;let c=f.trailing,m=s.splice(i,1)[0];if(!m)return null;s.splice(n,0,m);let h=s.map((d,u)=>`${d.body}${o[u]||""}`).join("");return`${e.slice(0,l)}${h}${c}`}function $(e,t){if(!t)throw new TypeError("Block operations need a block.");let i=t.range;if(!i)throw new TypeError("Block operations need a block range.");let n=[i.start],r=t.art?.source_range?.start;if(Number.isInteger(r)&&n.push(r),t.position_directive_id){let s=e?.directives?.find(o=>o.id===t.position_directive_id)?.range?.start;Number.isInteger(s)&&n.push(s)}return Math.min(...n)}function v(e,t){if(!e||!t)return null;let i=e.range;if(!i)return null;let n=$(t,e),r=i.end;return{from:n,to:r}}function w(e,t,i){if(!t)return null;let n=t.blocks||[],r=t.range;if(!r)return null;let l=i<n.length?n[i]:void 0;if(i<n.length&&!l)return null;let s=l?$(t,l):r.end;if(i<n.length)return`${e.slice(0,s)}New block

${e.slice(s)}`;let o=e.slice(0,s),f=o.trim()===""?"":o.endsWith(`
`)?`
`:`

`,c=t.delimiter_range?`
`:"";return`${e.slice(0,s)}${f}New block${c}${e.slice(s)}`}function A(e,t,i){if(!t||!i)return null;let n=v(i,t);if(!n)return null;let r=e.slice(0,n.from),l=e.slice(n.to);return(r.trim()===""&&l.startsWith(`
`)||l.startsWith(`
`)&&r.endsWith(`

`))&&(l=l.slice(1)),`${r}${l}`}function W(e,t,i,n){if(!t||n<0||n>=(t.blocks||[]).length)return null;let r=t.blocks||[],l=t.range;if(!l)return null;let s=[];for(let a of r){if(!a.range)return null;s.push({block:a,range:a.range})}let o=[],f=[],c=null,m=0;for(let{block:a,range:p}of s){let b=$(t,a),S=e.slice(p.start,p.end).match(/\r\n|\n|\r$/)?.[0]||"",x=p.end-S.length;o.push(e.slice(b,x)),c===null?c=b:f.push(e.slice(m,b)),m=x}if(c===null)return null;let h=e.slice(m,l.end),d=e.slice(l.start,c),u=o.splice(i,1)[0];if(u===void 0)return null;o.splice(n,0,u);let g=`${d}${o.map((a,p)=>`${a}${f[p]||""}`).join("")}${h}`;return`${e.slice(0,l.start)}${g}${e.slice(l.end)}`}function D(e){if(!e)return{horizontal:"left",vertical:"top",verticalExplicit:!1};let t=e.trim().split(/\s+/),i="top",n="left";if(t.length===1){let r=t[0]??"";["left","center","right"].includes(r)?n=r:["top","middle","bottom"].includes(r)&&(i=r)}else if(t.length>=2){let r=t[0]??"",l=t[1]??"";i=r==="center"?"middle":r,n=l}return{horizontal:n,vertical:i,verticalExplicit:i!=="top"}}function N(e,t,i){let n=i,r=e.slice(t,n).match(/(?:\r\n|\r|\n)$/)?.[0];if(!r){let l=e.slice(n).match(/^(?:\r\n|\r|\n)/)?.[0];l?(n+=l.length,r=l):r=`
`}return{from:t,to:n,lineEnding:r}}function I(e,t,i){let n=e.match(/\r\n|\r|\n/)?.[0]||`
`,r=`${i}${n}${n}`;return{updated:`${e.slice(0,t)}${r}${e.slice(t)}`,replacement:r,lineEnding:n}}function k(e,t){let i=t.end,n=e.slice(0,t.start);if(!e.slice(t.start,i).match(/(?:\r\n|\r|\n)$/)?.[0]){let s=e.slice(i).match(/^(?:\r\n|\r|\n)/)?.[0];s&&(i+=s.length)}let l=e.slice(i);return n.endsWith(`

`)&&l.startsWith(`
`)&&(l=l.slice(1)),{updated:`${n}${l}`,to:i}}function M(e,t){return[...t].sort((i,n)=>n.start-i.start).reduce((i,n)=>k(i,n).updated,e)}function L(e){let t=[];return{text:e.replace(/\$\{(\d+)(?::([^}]*))?\}/g,(n,r,l="")=>{let s=E(e,t);return t.push({number:Number(r),start:s,length:l.length}),l}),stops:t.sort((n,r)=>n.number===0?1:r.number===0?-1:n.number-r.number)}}function E(e,t){let i=[...e.matchAll(/\$\{\d+(?::[^}]*)?\}/g)],n=i[t.length];return!n||n.index===void 0?e.length:n.index-t.reduce((r,l,s)=>r+(i[s]?.[0].length??0)-l.length,0)}function O(e,t,i){let n=e.slice(0,t.from),r=e.slice(t.to),l=n.length===0||/\n\n$/.test(n)?"":/\n$/.test(n)?`
`:`

`,s=r.length===0||/^\n\n/.test(r)?"":/^\n/.test(r)?`
`:`

`;return`${l}${i}${s}`}export{_ as addSlide,v as blockOperationRange,$ as blockOperationStart,y as deleteSlide,N as directiveLineSpan,k as exciseRange,M as exciseRanges,L as expandSnippet,I as insertAlignDirective,w as insertBlock,O as mediaInsertText,W as moveBlock,B as moveSlide,D as parseAlignment,A as removeBlock};
