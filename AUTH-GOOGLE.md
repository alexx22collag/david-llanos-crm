# Acceso con Google en David Llanos Coaching

Google Cloud registra el CRM y su dirección de retorno una vez. Google verifica la identidad. El servidor del CRM comprueba el correo verificado y decide si es el administrador o si tiene una invitación activa.

El modo Google usa una base SQLite separada de la demo. El administrador de prueba está en la variable local **CRM_ADMIN_EMAIL**. La base de prueba empieza vacía. Las fichas de ejemplo y los cambios guardados en el navegador no se suben al servidor.

El proyecto de pruebas es [David Llanos CRM Test](https://console.cloud.google.com/auth/overview?project=tonal-depth-515821-r5). El cliente web **David Llanos Coaching Local** está activo y su única URI autorizada de retorno es la del servidor local. El 25 de noviembre de 2026 se verificó el inicio de sesión real con Google y la entrada al panel como administrador. La validación de cuentas invitadas y revocación se probó con cuentas simuladas.

## Configurar la prueba local

Requiere Node.js 24 o superior. Si no existe **.env.local**, copia **.env.example** y rellena **CRM_ADMIN_EMAIL** y **CRM_ORIGIN**. Para la prueba local usa **http://127.0.0.1:4174** y abre la app con ese mismo origen.

1. En [Google Auth Platform](https://console.cloud.google.com/auth/overview), selecciona el proyecto de prueba. Configura Marca y, para clientes con cuentas de distintos dominios, la audiencia **Externo**. Usa el nombre David Llanos Coaching y un correo de soporte que controle el propietario.
2. En **Clientes**, crea un cliente OAuth de tipo **Aplicación web**. Añade la URI de redireccionamiento autorizada exacta:

       http://127.0.0.1:4174/api/auth/google/callback

   El flujo se inicia desde el servidor y solo solicita **openid** y **email**. Se configura Gmail, Calendar o Meet por separado si se necesitan más adelante. [Flujo OAuth de Google](https://developers.google.com/identity/openid-connect/openid-connect)
3. Descarga el JSON del cliente OAuth y mantenlo en una carpeta privada. Desde el proyecto, ejecuta:

       npm run configure:google -- "C:\ruta\al\client_secret.json"

   El comando comprueba la URI y guarda el ID y el secreto en **.env.local**. También puedes introducir **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET** y **CRM_MODE=google** directamente en ese archivo. No subas el JSON ni **.env.local** al repositorio ni pegues el secreto en un chat.
4. Reinicia el servidor con **npm run dev**. Busca **CRM en modo Google** en la consola y abre **http://127.0.0.1:4174/**.

## Comprobar los accesos

1. Entra con la cuenta de prueba configurada como administrador. Crea una ficha con el correo real de una segunda cuenta de Google que controles.
2. En la ficha, pulsa **Habilitar acceso e invitar**. Puedes copiar el mensaje o abrir un borrador de correo. En local, el enlace solo abre este ordenador. Para invitar a clientes en otros dispositivos, usa la dirección HTTPS del servidor publicado.
3. En una ventana privada, abre el CRM y entra con la segunda cuenta. Debe aparecer solo su ficha y sus secciones de cliente.
4. Prueba con otra cuenta que no hayas invitado. Google puede reconocerla, pero el CRM debe indicar que no tiene acceso.
5. Pulsa **Revocar acceso** desde la ficha del administrador. La cuenta invitada pierde acceso a la API y la ficha conserva sus datos. Las altas y bajas se hacen en el CRM.

El estado de publicación OAuth de Google y los permisos del CRM son independientes. Publicar el cliente OAuth permite que Google lo presente a la audiencia configurada. La lista de invitados sigue siendo privada y se aplica en el servidor. [Audiencia y estado de Google OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)

## Pasar de la cuenta de prueba a la cuenta de David

- Cambia **CRM_ADMIN_EMAIL** al correo exacto de David y reinicia el servidor. Usa una cuenta de Google con ese correo. La cuenta de prueba pierde automáticamente el rol de administrador. Solo podría entrar como cliente si David la invita más adelante.
- Para una producción limpia, cambia **CRM_DB_PATH** a un archivo nuevo en un almacenamiento persistente. Si hay datos autorizados que quieras conservar, haz una copia de seguridad con el servidor detenido antes de mover la base. Conserva las copias en un lugar privado.
- David puede usar un proyecto OAuth que ya controle o crear otro en su cuenta. En un proyecto nuevo, configura la marca, crea otro cliente web y sustituye el ID y el secreto. Define **CRM_ORIGIN** con la URL HTTPS real y registra **https://tu-dominio/api/auth/google/callback** como retorno. Puedes rotar las credenciales tras el traspaso. Usa un cliente OAuth de producción separado del de pruebas.
- Sustituye el secreto de pruebas si el entorno local seguirá utilizándose. El secreto inicial se compartió en una captura y debe considerarse expuesto.
- Hospeda **server.mjs** junto a los archivos de **dist/** en un servidor Node con almacenamiento persistente. Expón HTTPS y conserva **.env.local** fuera de los archivos servidos. Detrás de un proxy puede configurarse **CRM_BIND=0.0.0.0**. Ajusta **PORT** al del servicio. Subir únicamente **dist/** a un alojamiento estático solo publica la demo.
- El correo de invitación se prepara en la ficha y se envía manualmente. La entrega automática, Google Calendar y Meet requieren sus propias integraciones y permisos.

## Activar el acceso por email

La opción **Continuar con email** permite entrar a clientes invitados sin cuenta de Google. El administrador entra con Google. Para habilitar el envío, añade **RESEND_API_KEY** y **CRM_EMAIL_FROM** en el servidor y reinícialo. Usa un remitente de un dominio verificado. En un piloto local, el enlace usa **CRM_ORIGIN** y solo funciona en el equipo que sirve la app. [Configuración de Resend](https://resend.com/docs/dashboard/domains/introduction)

El enlace dura quince minutos y es de un solo uso. La pantalla solicita una confirmación antes de canjearlo. El sistema solo genera enlaces para fichas habilitadas y no revela si un correo tiene acceso en la respuesta web.

Las páginas **privacidad.html** y **terminos.html** describen el piloto. Antes de publicar, completa la identidad y el contacto del responsable, bases del tratamiento, plazos, proveedores y transferencias aplicables, y las condiciones definitivas del servicio.

**npm test** prueba el administrador, la invitación, el aislamiento entre fichas, el uso único del intercambio y del enlace por correo y la revocación. Para validar producción, repite los pasos de navegador con el administrador definitivo y una cuenta invitada de prueba. El envío real de email solo se puede verificar con un remitente configurado.
