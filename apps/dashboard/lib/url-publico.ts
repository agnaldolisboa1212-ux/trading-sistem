/**
 * O endereço PÚBLICO de um caminho desta app, para redireccionamentos.
 *
 * Atrás do LiteSpeed o URL que o Next vê pode ter o protocolo e a porta
 * internos (http, porta da aplicação). Um redireccionamento feito com ele
 * mandava o browser para `http://trivohub.io:PORTA/…`. Usa-se o anfitrião que o
 * proxy reencaminha e HTTPS fixo, excepto em localhost: o `x-forwarded-proto`
 * não serve, porque o próprio Next o preenche com `http` quando a ligação do
 * proxy à aplicação é interna.
 *
 * O middleware do Next não aceita `Location` relativo (dá "Invalid URL" e 500).
 */
export function urlPublico(
  pedido: { headers: Headers; url: string },
  caminho: string,
): URL {
  const interno = new URL(pedido.url);
  const host = pedido.headers.get('x-forwarded-host') ?? pedido.headers.get('host') ?? interno.host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = local ? interno.protocol.replace(':', '') : 'https';
  return new URL(caminho, `${proto}://${host}`);
}
