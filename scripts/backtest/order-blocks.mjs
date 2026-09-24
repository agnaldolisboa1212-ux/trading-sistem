/**
 * Order blocks (ICT) — como sinal e como confluência.
 *
 * A definição é a mecânica do site do ICT: "a última vela de cor oposta antes
 * de um deslocamento". A zona é o intervalo dessa vela, e entra-se quando o
 * preço regressa lá.
 *
 * ── O BUG QUE ESTE FICHEIRO EXISTE PARA LEMBRAR ────────────────────────────
 *
 * A primeira versão dava +0,258R por operação com t=13,3 nas compras e t=10,5
 * nas vendas, robusto a tudo. Bom demais — e era. O bloco no índice i só fica
 * CONHECIDO três velas depois (é o deslocamento que o define), mas o código
 * deixava usá-lo já na vela seguinte:
 *
 *     if (b.lado !== lado || b.i >= i) continue;   // ERRADO
 *
 * Ou seja: entrava mesmo antes de um movimento forte que o próprio teste já
 * sabia que ia acontecer. Com a confirmação correcta (CONFIRMA = 3) o
 * resultado passa de +0,258R para −0,044R.
 *
 * Fica escrito porque a lição vale mais do que a medição: um t de 13 num
 * sistema de trading não é um bom resultado, é um bug por encontrar.
 *
 * ── O QUE DEU, com o bug corrigido (24/09/2026) ────────────────────────────
 *
 *   sinal autónomo   NEGATIVO em todas as variantes, nos dois sentidos
 *   confluência      PIORA o rompimento de 4h (+0,159R → +0,120R) e corta
 *                    dois terços dos sinais
 *
 * Uso: node scripts/backtest/order-blocks.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/';
const DIR = (process.env.HISTDATA ?? RAIZ + 'data/backtest/histdata') + '/';
const DIARIO = RAIZ + 'data/backtest/diario/';
const HORA=3600000, CORTE=Date.UTC(2024,6,1);
const M=[['GER30','GRXEUR',2],['SP500','SPXUSD',0.6],['US100','NSXUSD',1.8],['JP225','JPXJPY',12],
 ['EURUSD','EURUSD',0.00012],['GBPUSD','GBPUSD',0.00018],['USDJPY','USDJPY',0.012],
 ['XAUUSD','XAUUSD',0.35],['EURJPY','EURJPY',0.018],['XAGUSD','XAGUSD',0.03]];
const ROMP=[['XAUUSD','XAUUSD',0.35],['USDJPY','USDJPY',0.012],['XAGUSD','XAGUSD',0.03],['EURJPY','EURJPY',0.018]];
function velas4h(f){const v=JSON.parse(readFileSync(`${DIR}${f}_1h.json`,'utf8')),p=4*HORA,o=[];
 for(const c of v){const k=c.time-(c.time%p),u=o[o.length-1];
  if(u&&u.time===k){u.high=Math.max(u.high,c.high);u.low=Math.min(u.low,c.low);u.close=c.close;}
  else o.push({...c,time:k});}return o;}
function atrS(v,p=14){const a=new Float64Array(v.length);let x=0;
 for(let i=0;i<v.length;i++){const tr=i===0?v[i].high-v[i].low:Math.max(v[i].high-v[i].low,Math.abs(v[i].high-v[i-1].close),Math.abs(v[i].low-v[i-1].close));
  x=i<p?(x*i+tr)/(i+1):(x*(p-1)+tr)/p;a[i]=x;}return a;}
function obs(v,atr,d=2,n=3){const o=[];
 for(let i=1;i<v.length-n;i++){const baixa=v[i].close<v[i].open,alta=v[i].close>v[i].open,a=atr[i];
  if((!baixa&&!alta)||!(a>0))continue;let su=0,de=0;
  for(let k=i+1;k<=i+n;k++){su=Math.max(su,v[k].high-v[i].close);de=Math.max(de,v[i].close-v[k].low);}
  if(baixa&&su>=d*a)o.push({i,lado:1,baixo:v[i].low,alto:v[i].high});
  else if(alta&&de>=d*a)o.push({i,lado:-1,baixo:v[i].low,alto:v[i].high});}
 return o;}
// CONFIRMACAO: o bloco so e CONHECIDO depois das 3 velas de deslocamento. Usa-lo
// antes disso e ver o futuro — era o que este codigo fazia, e dava t=13.
const CONFIRMA = 3;
function obEm(o,i,preco,lado,janela=60){for(let k=o.length-1;k>=0;k--){const b=o[k];
 if(b.lado!==lado||i-b.i<CONFIRMA)continue; if(i-b.i>janela)break;
 if(preco>=b.baixo&&preco<=b.alto)return b;}return null;}
function obAbaixo(o,i,preco,atr,janela=60){for(let k=o.length-1;k>=0;k--){const b=o[k];
 if(b.lado!==1||i-b.i<CONFIRMA)continue; if(i-b.i>janela)break;
 if(b.alto<preco&&preco-b.alto<=2*atr)return b;}return null;}
function reg(par){let d;try{d=JSON.parse(readFileSync(`${DIARIO}${par}.json`,'utf8'));}catch{return null;}
 const p=[];let s=0;for(let i=0;i<d.length;i++){s+=d[i].close;if(i>=200)s-=d[i-200].close;
  if(i>=199)p.push({t:d[i].time,alta:d[i].close>s/200});}
 return (t)=>{let r=null;for(const x of p){if(x.t>=t)break;r=x.alta;}return r;};}
const st=(rs)=>{const n=rs.length;if(n<3)return{n,media:0,t:0,acerto:0};
 const m=rs.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(rs.reduce((a,r)=>a+(r-m)**2,0)/(n-1));
 return{n,media:m,t:m/(sd/Math.sqrt(n)),acerto:rs.filter(r=>r>0).length/n};};
const mostra=(rot,ops)=>{if(ops.length<20){console.log(rot.padEnd(36)+ops.length+' (poucas)');return;}
 ops.sort((a,b)=>a.t-b.t);const s=st(ops.map(o=>o.r)),a=st(ops.filter(o=>o.t<CORTE).map(o=>o.r)),b=st(ops.filter(o=>o.t>=CORTE).map(o=>o.r));
 const ok=a.media>0&&b.media>0&&s.t>=1.5;
 console.log(((ok?'✅ ':'   ')+rot).padEnd(36)+String(s.n).padStart(6)+`${(100*s.acerto).toFixed(0)}%`.padStart(6)+
  `${s.media>=0?'+':''}${s.media.toFixed(3)}R`.padStart(10)+`t=${s.t.toFixed(1)}`.padStart(8)+
  `${a.media>=0?'+':''}${a.media.toFixed(3)}`.padStart(9)+`${b.media>=0?'+':''}${b.media.toFixed(3)}`.padStart(9));};

console.log('1) OB com STOP MAIS LARGO — o custo pesa menos por R\n');
console.log('variante'.padEnd(36)+'n'.padStart(6)+'acerto'.padStart(6)+'R/op'.padStart(10)+'t'.padStart(8)+'1.ª'.padStart(9)+'2.ª'.padStart(9));
for (const stopMin of [0, 1, 1.5, 2]) {
  for (const cm of [1, 2]) {
    for (const lado of [1, -1]) {
      const todas=[];
      for (const [nome,f,custo] of M) {
        let v;try{v=velas4h(f);}catch{continue;}
        const atr=atrS(v),o=obs(v,atr,2),R=reg(nome);let livre=-1;
        for(let i=60;i<v.length-1;i++){
          if(i<=livre)continue;const a=atr[i];if(!(a>0))continue;
          const b=obEm(o,i,v[i].close,lado);if(!b)continue;
          const alta=R?R(v[i].time):null;if(alta===null||(lado>0)!==alta)continue;
          const e=v[i].close, bruto=lado>0?b.baixo-0.25*a:b.alto+0.25*a;
          const risco=Math.max(Math.abs(e-bruto),stopMin*a);
          if(!(risco>0))continue;
          let r=null,k=i+1;
          for(;k<=Math.min(i+12,v.length-1);k++){
            if((lado>0?e-v[k].low:v[k].high-e)/risco>=1){r=-1;break;}
            if((lado>0?v[k].high-e:e-v[k].low)/risco>=2){r=2;break;}}
          livre=k;
          if(r===null)r=((v[Math.min(i+12,v.length-1)].close-e)*lado)/risco;
          todas.push({t:v[i].time,r:r-(custo*cm)/risco});}
      }
      mostra(`stop min ${stopMin} ATR · custo x${cm} · ${lado>0?'COMPRA':'VENDA '}`, todas);
    }
  }
}

console.log('\n2) OB como CONFLUÊNCIA no rompimento de 4h\n');
for (const exigir of [false, true]) {
  const todas=[];
  for (const [nome,f,custo] of ROMP) {
    let v;try{v=velas4h(f);}catch{continue;}
    const n=v.length,atr=atrS(v),e50=new Float64Array(n),e200=new Float64Array(n);
    for(let i=0;i<n;i++){const c=v[i].close;
      e50[i]=i===0?c:e50[i-1]+(2/51)*(c-e50[i-1]);e200[i]=i===0?c:e200[i-1]+(2/201)*(c-e200[i-1]);}
    const o=obs(v,atr,2);
    const disp=(i)=>{if(!(e50[i]>e200[i]))return false;let hi=-Infinity;for(let k=i-20;k<i;k++)hi=Math.max(hi,v[k].high);return v[i].close>hi;};
    for(let i=210;i<n-1;i++){
      if(!disp(i))continue;let rec=false;for(let k=Math.max(210,i-6);k<i&&!rec;k++)if(disp(k))rec=true;if(rec)continue;
      if(exigir && !obAbaixo(o,i,v[i].close,atr[i]))continue;
      const e=v[i].close,risco=1.5*atr[i];if(!(risco>0))continue;
      let r=null;
      for(let j=i+1;j<=Math.min(i+6,n-1);j++){
        if((e-v[j].low)/risco>=1){r=-1;break;}
        if((v[j].high-e)/risco>=3){r=3;break;}}
      if(r===null)r=(v[Math.min(i+6,n-1)].close-e)/risco;
      todas.push({t:v[i].time,r:r-custo*0.7/risco});}
  }
  mostra(exigir?'COM order block por baixo':'sem confluência (a regra actual)', todas);
}
