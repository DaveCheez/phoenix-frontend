import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.MOCK_DJANGO_PORT || 9999);
const product = { id: 101, name: 'CI Test Roof Rack', slug: 'ci-test-roof-rack', price: '695.00', thumbnail_image: 'https://example.invalid/test.jpg' };
const category = { id: 1, name: 'Roof Racks', slug: 'roof-racks', description: 'CI test category' };
const slides = [{ id: 1, title: 'CI Test Slide', subtitle: 'Dynamic slide smoke test', image: '/images/home/crafter-beach.jpg', mobile_image: null, button_text: 'View Roof Racks', button_url: '/category/roof-racks' }];
const carts = new Map();
const sendJson = (res, status, body) => { const payload = JSON.stringify(body); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(payload); };
const parseBody = (req) => new Promise((resolve, reject) => { let raw=''; req.on('data', c => raw += c); req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } }); req.on('error', reject); });
const cartPayload = cart => { const items=[...cart.items.values()]; const total=items.reduce((s,i)=>s + Number(i.quantity)*Number(i.price),0); return {id:cart.id,items,item_count:items.reduce((s,i)=>s+i.quantity,0),total:total.toFixed(2)}; };
const getCart = id => id && carts.get(id);
const newCart = () => { const id=randomUUID(); const cart={id,items:new Map()}; carts.set(id,cart); return cart; };
const server=createServer(async (req,res)=>{ try { const u=new URL(req.url,`http://${req.headers.host}`); const p=u.pathname.replace(/^\/api\/?/,'');
if(req.method==='GET'&&p==='health') return sendJson(res,200,{status:'ok'});
if(req.method==='GET'&&p==='categories/') return sendJson(res,200,[category]);
if(req.method==='GET'&&p==='products/') return sendJson(res,200,[product]);
if(req.method==='GET'&&p==='products/ci-test-roof-rack/') return sendJson(res,200,product);
if(req.method==='GET'&&p==='slides/') return sendJson(res,200,slides);
if(req.method==='POST'&&p==='cart/create/') { const c=newCart(); return sendJson(res,200,{success:true,cart_id:c.id,cart:cartPayload(c)}); }
if(req.method==='GET'&&p==='cart/') { const c=getCart(u.searchParams.get('cart_id')); if(!c) return sendJson(res,404,{success:false,code:'CART_NOT_FOUND',error:'Cart not found'}); return sendJson(res,200,{success:true,cart:cartPayload(c)}); }
if(req.method==='POST'&&p==='cart/add/') { const b=await parseBody(req); const c=getCart(b.cart_id); if(!c) return sendJson(res,404,{success:false,code:'CART_NOT_FOUND',error:'Cart not found'}); const key=String(product.id); const q=(c.items.get(key)?.quantity||0)+Number(b.quantity||1); c.items.set(key,{item_id:1,product_id:product.id,name:product.name,price:product.price,quantity:q,line_total:(q*Number(product.price)).toFixed(2)}); return sendJson(res,200,{success:true,cart:cartPayload(c)}); }
if((req.method==='POST'||req.method==='PATCH')&&p==='cart/update/') { const b=await parseBody(req); const c=getCart(b.cart_id); if(!c) return sendJson(res,404,{success:false,code:'CART_NOT_FOUND',error:'Cart not found'}); const q=Number(b.quantity); if(q<=0)c.items.clear(); else c.items.set(String(product.id),{item_id:1,product_id:product.id,name:product.name,price:product.price,quantity:q,line_total:(q*Number(product.price)).toFixed(2)}); return sendJson(res,200,{success:true,cart:cartPayload(c)}); }
return sendJson(res,404,{success:false,error:'Unknown endpoint'});
} catch(e) { console.error(e); sendJson(res,500,{success:false,error:'mock api error'}); }});
server.listen(port,'127.0.0.1',()=>console.log(`Mock Django API listening on ${port}`));
const shutdown=()=>server.close(()=>process.exit(0)); process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
