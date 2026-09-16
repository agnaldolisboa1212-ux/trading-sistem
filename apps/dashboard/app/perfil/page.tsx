import { redirect } from 'next/navigation';

/**
 * O antigo "Perfil" passou a chamar-se "Definições".
 *
 * O redirecionamento fica: links guardados, marcadores e a barra de navegação
 * de versões antigas ainda apontam para cá, e um 404 seria pior do que uma
 * linha de código.
 */
export default function Page() {
  redirect('/definicoes');
}
