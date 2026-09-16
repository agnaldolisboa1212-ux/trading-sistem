import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap">
      <header className="top">
        <h1>Página não encontrada</h1>
        <p>O endereço que seguiu não corresponde a nada neste painel.</p>
      </header>
      <Link href="/" className="backlink">
        ← voltar ao radar
      </Link>
    </div>
  );
}
