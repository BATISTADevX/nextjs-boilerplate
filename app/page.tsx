import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, 
  deleteDoc, addDoc, runTransaction 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'jbsys-pro-v23';

const MASTER_ADMIN = { id: "5116", pin: "4143", nome: "ADMIN MASTER", nivel: 1 };
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

const App = () => {
  const [user, setUser] = useState(null);
  const [bootPhase, setBootPhase] = useState(0); 
  const [bootLogs, setBootLogs] = useState([]);
  const [notification, setNotification] = useState(null);
  const [view, setView] = useState('login');

  // Estados de Dados (Firestore)
  const [catalogo, setCatalogo] = useState([]);
  const [equipa, setEquipa] = useState([]);
  const [vendasLogs, setVendasLogs] = useState([]);
  
  // Interface PDV
  const [carrinho, setCarrinho] = useState([]);
  const [busca, setBusca] = useState('');
  const [isCartVisible, setIsCartVisible] = useState(false);
  const [metodoPagamento, setMetodoPagamento] = useState('CARTÃO');
  const [valorRecebido, setValorRecebido] = useState('');

  const addLog = (msg) => setBootLogs(prev => [...prev.slice(-5), `> ${msg}`]);
  const notify = useCallback((msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // --- BOOT DIAGNOSTICS & AUTH (REGRA 3) ---
  useEffect(() => {
    const runDiagnostics = async () => {
      addLog("INICIALIZANDO KERNEL JBSYS...");
      addLog("CONECTANDO AO DATA CENTER...");
      try {
        // Garante autenticação antes de qualquer query
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
        
        // Listeners após autenticação
        const pathInv = collection(db, 'artifacts', appId, 'public', 'data', 'inventory');
        const pathUsers = collection(db, 'artifacts', appId, 'public', 'data', 'users');
        const pathSales = collection(db, 'artifacts', appId, 'public', 'data', 'vendas');

        onSnapshot(pathInv, s => setCatalogo(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
        onSnapshot(pathUsers, s => setEquipa(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
        onSnapshot(pathSales, s => setVendasLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));

        addLog("PROTOCOLOS DE SEGURANÇA OK.");
        addLog("INTERFACE CARREGADA.");
        setTimeout(() => setBootPhase(3), 2000);
      } catch (e) { 
        addLog("ERRO DE CONEXÃO."); 
        console.error(e);
      }
    };
    runDiagnostics();
  }, [appId]);

  // --- LÓGICA DE NEGÓCIO ---
  const subTotal = useMemo(() => carrinho.reduce((acc, curr) => acc + (curr.qtd * curr.preco), 0), [carrinho]);
  const troco = useMemo(() => {
    const v = parseFloat(valorRecebido) || 0;
    return v > subTotal ? v - subTotal : 0;
  }, [valorRecebido, subTotal]);

  const stats = useMemo(() => {
    const fat = vendasLogs.reduce((acc, v) => acc + (v.total || 0), 0);
    const totalItens = catalogo.reduce((acc, i) => acc + (i.stock || 0), 0);
    const valorEstoque = catalogo.reduce((acc, i) => acc + ((i.stock || 0) * (i.preco || 0)), 0);
    return { fat, qtd: vendasLogs.length, items: totalItens, valorEstoque };
  }, [vendasLogs, catalogo]);

  const addToCart = (item) => {
    if (item.stock <= 0) return notify("SEM ESTOQUE", "error");
    setCarrinho(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) return ex.qtd >= item.stock ? prev : prev.map(i => i.id === item.id ? {...i, qtd: i.qtd + 1} : i);
      return [...prev, { ...item, qtd: 1 }];
    });
  };

  const processarVenda = async () => {
    if (!carrinho.length) return;
    if (!auth.currentUser) return notify("ERRO: SESSÃO INVÁLIDA", "error");

    try {
      await runTransaction(db, async (t) => {
        for (const i of carrinho) {
          const ref = doc(db, 'artifacts', appId, 'public', 'data', 'inventory', i.id);
          const s = await t.get(ref);
          if (!s.exists()) throw `Item ${i.nome} não encontrado`;
          const currentStock = s.data().stock;
          if (currentStock < i.qtd) throw `Estoque insuficiente: ${i.nome}`;
          t.update(ref, { stock: currentStock - i.qtd });
        }
        const vRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'vendas'));
        t.set(vRef, { 
          total: subTotal, 
          metodo: metodoPagamento, 
          operador: user.nome, 
          timestamp: Date.now(), 
          vendaId: Math.random().toString(36).substr(2, 6).toUpperCase(),
          itensQtd: carrinho.length
        });
      });
      setCarrinho([]); setValorRecebido(''); setIsCartVisible(false); notify("VENDA CONCLUÍDA", "success");
    } catch (e) { 
      console.error(e);
      notify("ERRO NO BANCO", "error"); 
    }
  };

  // --- RENDER BOOT ---
  if (bootPhase < 3) return (
    <div className="h-screen bg-[#050505] flex flex-col items-center justify-center p-6 font-mono text-emerald-500">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-3xl font-black italic tracking-tighter text-white">JBSYS<span className="text-emerald-500">.</span>CORE</h1>
        <div className="bg-zinc-900/40 p-5 rounded-2xl border border-white/5 space-y-2 h-40 flex flex-col justify-end">
          {bootLogs.map((l, i) => <p key={i} className="text-[10px] leading-tight opacity-70">{l}</p>)}
          <div className="h-1 bg-zinc-800 w-full mt-4 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 animate-pulse w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-[#020202] text-zinc-400 font-sans flex flex-col md:flex-row overflow-hidden text-[10px]">
      
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-6 py-2 bg-white text-black font-black uppercase rounded-full shadow-2xl">
          {notification.msg}
        </div>
      )}

      {user && (
        <nav className="w-full md:w-16 bg-black border-b md:border-b-0 md:border-r border-white/5 flex md:flex-col items-center justify-around md:justify-start py-3 md:py-8 gap-6 z-50">
          <div className="hidden md:block text-white font-black italic text-xl mb-6 cursor-pointer" onClick={() => setView('portal')}>JB</div>
          {[
            { id: 'pdv', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z', label: 'PDV' },
            { id: 'estoque', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', label: 'STK', admin: true },
            { id: 'relatorios', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z', label: 'BI', admin: true },
            { id: 'equipe', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z', label: 'USR', admin: true }
          ].map(btn => (
            (!btn.admin || user.nivel === 1) && (
              <button key={btn.id} onClick={() => setView(btn.id)} className={`p-3 rounded-xl transition-all ${view === btn.id ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-zinc-600 hover:text-white hover:bg-white/5'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2.5} d={btn.icon}/></svg>
              </button>
            )
          ))}
          <button onClick={() => { setUser(null); setView('login'); }} className="p-3 text-zinc-800 hover:text-red-500 md:mt-auto"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7"/></svg></button>
        </nav>
      )}

      <main className="flex-1 overflow-hidden relative">
        {view === 'login' && (
          <div className="h-full flex items-center justify-center bg-[#020202]">
            <div className="w-full max-w-[260px] space-y-10">
              <div className="text-center">
                <h1 className="text-5xl font-black text-white italic tracking-tighter">JBSYS</h1>
                <p className="text-[7px] text-zinc-800 tracking-[6px] uppercase mt-2">Enterprise Access</p>
              </div>
              <form onSubmit={e => {
                e.preventDefault();
                const id = e.target.id.value;
                const pin = e.target.pin.value;
                const f = id === MASTER_ADMIN.id && pin === MASTER_ADMIN.pin ? MASTER_ADMIN : equipa.find(u => u.matricula === id && u.senha === pin);
                if (f) { setUser(f); setView(f.nivel === 1 ? 'portal' : 'pdv'); } else notify("NEGADO", "error");
              }} className="space-y-3">
                <input name="id" placeholder="ID MATRÍCULA" className="w-full p-4 bg-zinc-900/50 border border-white/5 rounded-xl text-white font-black text-center outline-none" />
                <input name="pin" type="password" placeholder="PIN" className="w-full p-4 bg-zinc-900/50 border border-white/5 rounded-xl text-white font-black text-center outline-none" />
                <button className="w-full bg-white text-black py-4 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-500 transition-all">Aceder</button>
              </form>
            </div>
          </div>
        )}

        {view === 'pdv' && (
          <div className="h-full flex flex-col p-4 md:p-6 space-y-4">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter">Checkout</h2>
              <div className="flex items-center gap-2">
                <input placeholder="BUSCAR PRODUTO..." className="flex-1 md:w-80 bg-zinc-900/40 p-3 rounded-xl text-[10px] font-black text-white uppercase outline-none border border-white/5" onChange={e => setBusca(e.target.value.toUpperCase())} />
                <button onClick={() => setIsCartVisible(true)} className="bg-emerald-500 text-black px-5 py-3 rounded-xl font-black text-[10px] uppercase flex items-center gap-3 shadow-lg">
                  Cesto <span className="bg-black text-white px-2 py-0.5 rounded-lg text-[8px]">{carrinho.length}</span>
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 pr-2 custom-scrollbar">
              {catalogo.filter(i => i.nome.includes(busca)).map(item => (
                <button key={item.id} onClick={() => addToCart(item)} className={`bg-zinc-900/20 border border-white/5 p-4 rounded-2xl text-left hover:border-emerald-500/40 transition-all active:scale-95 flex flex-col justify-between h-36 md:h-44 group ${item.stock <= 0 ? 'opacity-30' : ''}`}>
                  <div className="space-y-1">
                    <span className="text-[7px] text-zinc-700 font-black uppercase">{item.ref}</span>
                    <h4 className="text-[10px] font-black text-white uppercase leading-tight line-clamp-2">{item.nome}</h4>
                  </div>
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-base font-black text-white">{formatCurrency(item.preco)}</p>
                    <span className={`text-[8px] font-bold ${item.stock < 5 ? 'text-red-500' : 'text-zinc-600'}`}>Qtd: {item.stock}</span>
                  </div>
                </button>
              ))}
            </div>

            {isCartVisible && (
              <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex justify-end">
                <div className="w-full max-w-[340px] bg-[#080808] border-l border-white/5 h-full flex flex-col p-6 shadow-2xl animate-in slide-in-from-right-8">
                  <header className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black text-white italic tracking-tighter">REVISÃO</h3>
                    <button onClick={() => setIsCartVisible(false)} className="text-[9px] font-black text-zinc-700 hover:text-white uppercase tracking-widest">Fechar</button>
                  </header>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {carrinho.map(i => (
                      <div key={i.id} className="bg-zinc-900/30 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                        <div className="flex-1 pr-4">
                          <p className="text-[10px] font-black text-white uppercase truncate">{i.nome}</p>
                          <p className="text-emerald-500 font-bold text-[11px]">{formatCurrency(i.preco * i.qtd)}</p>
                        </div>
                        <div className="flex items-center gap-3 bg-black/50 p-2 rounded-xl border border-white/5">
                          <button onClick={() => setCarrinho(p => p.map(x => x.id === i.id ? {...x, qtd: Math.max(0, x.qtd-1)} : x).filter(x => x.qtd > 0))} className="text-zinc-500 hover:text-white w-4 font-bold">-</button>
                          <span className="font-mono text-white text-[10px] font-black w-4 text-center">{i.qtd}</span>
                          <button onClick={() => addToCart(i)} className="text-zinc-500 hover:text-white w-4 font-bold">+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-6 border-t border-white/5 mt-4 space-y-5">
                    <div className="grid grid-cols-2 gap-2">
                      {['CARTÃO', 'PIX', 'DINHEIRO'].map(m => (
                        <button key={m} onClick={() => setMetodoPagamento(m)} className={`py-3 rounded-xl text-[9px] font-black border ${metodoPagamento === m ? 'bg-white text-black border-white' : 'bg-transparent text-zinc-600 border-white/5'}`}>{m}</button>
                      ))}
                    </div>
                    {metodoPagamento === 'DINHEIRO' && (
                      <input type="number" placeholder="VALOR RECEBIDO" value={valorRecebido} onChange={e => setValorRecebido(e.target.value)} className="w-full bg-zinc-900 border border-white/10 p-4 rounded-xl text-white font-black text-center text-lg outline-none" />
                    )}
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-black uppercase text-zinc-600 tracking-widest">Total</span>
                      <span className="text-3xl font-black text-white tracking-tighter">{formatCurrency(subTotal)}</span>
                    </div>
                    <button onClick={processarVenda} className="w-full bg-emerald-500 text-black py-5 rounded-2xl font-black uppercase tracking-[3px] text-[11px] shadow-xl hover:scale-[1.02] active:scale-95 transition-all">Finalizar Venda</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'estoque' && user.nivel === 1 && (
          <div className="h-full p-6 md:p-10 flex flex-col space-y-6">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase leading-none">Estoque</h2>
              <div className="flex gap-4">
                <div className="text-right">
                    <p className="text-[8px] text-zinc-600 uppercase font-black">Patrimônio</p>
                    <p className="text-lg font-black text-emerald-500">{formatCurrency(stats.valorEstoque)}</p>
                </div>
                <button onClick={() => addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'inventory'), { nome: 'NOVO ITEM', preco: 0, stock: 0, ref: 'SKU-'+Math.random().toString(36).substr(2,4).toUpperCase(), timestamp: Date.now() })} className="bg-white text-black px-8 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-emerald-500">Cadastrar</button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {catalogo.sort((a,b)=>b.timestamp-a.timestamp).map(item => (
                <div key={item.id} className="bg-zinc-900/10 border border-white/5 p-4 rounded-xl grid grid-cols-12 gap-4 items-center group">
                  <div className="col-span-2">
                    <input defaultValue={item.ref} onBlur={e => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id), { ref: e.target.value.toUpperCase() }, { merge: true })} className="w-full bg-black/40 p-2 rounded-lg text-[9px] text-zinc-500 font-mono outline-none border border-white/5" />
                  </div>
                  <div className="col-span-5">
                    <input defaultValue={item.nome} onBlur={e => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id), { nome: e.target.value.toUpperCase() }, { merge: true })} className="w-full bg-transparent text-white font-black text-[11px] uppercase outline-none" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" defaultValue={item.preco} onBlur={e => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id), { preco: parseFloat(e.target.value) }, { merge: true })} className="w-full bg-black/40 p-2.5 rounded-lg text-emerald-500 font-black text-right outline-none border border-white/5" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" defaultValue={item.stock} onBlur={e => setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id), { stock: parseInt(e.target.value) }, { merge: true })} className={`w-full bg-black/40 p-2.5 rounded-lg font-black text-right outline-none border border-white/5 ${item.stock < 5 ? 'text-red-500' : 'text-white'}`} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'inventory', item.id))} className="text-zinc-900 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'relatorios' && user.nivel === 1 && (
          <div className="h-full p-6 md:p-10 flex flex-col space-y-8">
            <header className="flex flex-col md:flex-row items-center justify-between border-b border-white/5 pb-8 gap-6">
                <div className="space-y-1 w-full md:w-auto text-center md:text-left">
                    <h2 className="text-5xl font-black text-white italic tracking-tighter uppercase">Intelligence</h2>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full md:w-auto">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-3xl min-w-[180px]">
                        <p className="text-[9px] font-black text-emerald-800 uppercase mb-2">Total Bruto</p>
                        <p className="text-3xl font-black text-emerald-500 tracking-tighter">{formatCurrency(stats.fat)}</p>
                    </div>
                    <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-3xl min-w-[180px]">
                        <p className="text-[9px] font-black text-zinc-700 uppercase mb-2">Ticket Médio</p>
                        <p className="text-3xl font-black text-white tracking-tighter">{formatCurrency(stats.fat / (stats.qtd || 1))}</p>
                    </div>
                </div>
            </header>
            <div className="flex-1 bg-black border border-white/5 rounded-[2.5rem] overflow-hidden">
                <div className="overflow-x-auto h-full custom-scrollbar">
                    <table className="w-full text-left">
                        <thead className="bg-zinc-900/50 text-[9px] font-black uppercase text-zinc-700 sticky top-0 backdrop-blur-xl">
                            <tr>
                                <th className="p-6">Ref</th>
                                <th className="p-6">Data</th>
                                <th className="p-6">Operador</th>
                                <th className="p-6">Método</th>
                                <th className="p-6 text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody className="text-[10px] font-mono">
                            {vendasLogs.sort((a,b)=>b.timestamp-a.timestamp).map(v => (
                                <tr key={v.id} className="border-b border-white/[0.02] hover:bg-white/[0.01]">
                                    <td className="p-6 text-zinc-700">#{v.vendaId}</td>
                                    <td className="p-6 text-zinc-500">{new Date(v.timestamp).toLocaleString()}</td>
                                    <td className="p-6 text-white uppercase italic font-bold">{v.operador}</td>
                                    <td className="p-6 text-zinc-500 uppercase">{v.metodo}</td>
                                    <td className="p-6 text-right text-emerald-500 font-black">{formatCurrency(v.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        )}

        {view === 'equipe' && user.nivel === 1 && (
            <div className="h-full p-6 md:p-12 flex flex-col space-y-10">
                <h2 className="text-4xl font-black text-white italic uppercase tracking-tighter">Equipe</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <form onSubmit={async e => {
                        e.preventDefault(); const d = new FormData(e.target);
                        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'users'), { 
                          nome: d.get('n').toUpperCase(), matricula: d.get('m'), senha: d.get('s'), nivel: parseInt(d.get('v')), timestamp: Date.now() 
                        });
                        e.target.reset(); notify("COLABORADOR CRIADO", "success");
                    }} className="bg-zinc-900/20 p-8 rounded-[2.5rem] border border-white/5 space-y-4">
                        <input name="n" placeholder="NOME" className="w-full bg-black/50 border border-white/5 p-4 rounded-xl text-[10px] text-white font-black outline-none" required />
                        <div className="grid grid-cols-2 gap-4">
                            <input name="m" placeholder="MATRÍCULA" className="w-full bg-black/50 border border-white/5 p-4 rounded-xl text-[10px] text-white font-black outline-none" required />
                            <input name="s" type="password" placeholder="PIN" className="w-full bg-black/50 border border-white/5 p-4 rounded-xl text-[10px] text-white font-black outline-none" required />
                        </div>
                        <select name="v" className="w-full bg-black border border-white/5 p-4 rounded-xl text-[10px] text-white font-black outline-none appearance-none">
                            <option value="2">OPERADOR</option>
                            <option value="1">ADMINISTRADOR</option>
                        </select>
                        <button className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest mt-4">Registrar</button>
                    </form>
                    <div className="space-y-2 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                        {equipa.map(f => (
                            <div key={f.id} className="bg-zinc-900/10 border border-white/5 p-5 rounded-2xl flex items-center justify-between group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[9px] ${f.nivel === 1 ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>
                                        {f.nivel === 1 ? 'ADM' : 'OP'}
                                    </div>
                                    <p className="text-xs font-black text-white uppercase italic">{f.nome}</p>
                                </div>
                                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', f.id))} className="text-zinc-900 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {view === 'portal' && (
            <div className="h-full flex flex-col items-center justify-center p-6 space-y-16">
                <div className="text-center">
                    <h2 className="text-[6rem] md:text-[10rem] font-black text-white italic tracking-tighter uppercase leading-none select-none">PORTAL<span className="text-emerald-500">.</span></h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-5xl">
                    {[
                      { id: 'pdv', label: 'Vendas' }, { id: 'estoque', label: 'Estoque' }, { id: 'relatorios', label: 'Financeiro' }, { id: 'equipe', label: 'Equipe' }
                    ].map(item => (
                        <button key={item.id} onClick={() => setView(item.id)} className="bg-zinc-900/20 p-10 rounded-[3rem] border border-white/5 hover:bg-zinc-900/50 transition-all flex flex-col items-center gap-4 group">
                            <div className="w-14 h-14 rounded-2xl bg-zinc-900 text-white border border-white/5 shadow-2xl flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeWidth={2.5} d={
                                    item.id === 'pdv' ? 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' :
                                    item.id === 'estoque' ? 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4' :
                                    item.id === 'relatorios' ? 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2' : 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z'
                                  }/>
                                </svg>
                            </div>
                            <span className="block text-[11px] font-black text-white uppercase tracking-widest">{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 20px; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  );
};

export default App;

