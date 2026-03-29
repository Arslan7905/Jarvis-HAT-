# JarvisAI

Voice-first Jarvis UI with:

- live wake-word voice control
- AI backend fallback for general questions
- structured automation routing
- direct ESP32 device control over HTTP or WebSocket

## ESP32 Wi-Fi Bring-Up

The app-side HTTP and WebSocket transport already exists.

For the fastest first real-world test:

1. Use HTTP first, not WebSocket.
2. Flash the sample sketch in [esp32/jarvis_http_relay/jarvis_http_relay.ino](esp32/jarvis_http_relay/jarvis_http_relay.ino)
3. Follow the setup guide in [docs/esp32-http-setup.md](docs/esp32-http-setup.md)
4. In the Admin Panel:
   - disable `Use Mock Devices`
   - set `Transport Mode` to `HTTP`
   - set `ESP32 HTTP Endpoint` to `http://<ESP32-IP>/control`
5. Run `Test device transport`
6. Try a typed command before voice

The currently documented first relay mapping is:

- `device: "lights"`
- `location: "living_room"`

That matches the existing frontend registry.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

Set `REACT_APP_AI_API_URL` if the TV UI should call an AI backend URL other
than `http://localhost:3001/api/ai/chat`.

You can also set:

- `REACT_APP_ESP32_PROTOCOL=http`
- `REACT_APP_ESP32_HTTP_URL=http://192.168.1.50/control`
- `REACT_APP_ESP32_WS_URL=ws://192.168.1.50/ws`

### `npm run server`

Starts the Jarvis AI backend on [http://localhost:3001](http://localhost:3001).
Set `OPENAI_API_KEY` before starting it. You can optionally set
`CORS_ORIGIN` to restrict which frontend origins are allowed to call the API.
The backend can also use OpenRouter keys via `OPENROUTER_API_KEY`, or it can
auto-detect an OpenRouter-style key already stored in `OPENAI_API_KEY`.

### `npm run server:dev`

Starts the same backend with `nodemon` for local development.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

## AI Backend API

The Express backend exposes `POST /api/ai/chat` and expects JSON like:

```json
{
  "prompt": "What can you do?"
}
```

Successful responses return:

```json
{
  "text": "AI response from ChatGPT"
}
```

If the request is invalid or the OpenAI call fails, the backend returns a JSON
error response.

The TV UI uses this endpoint for general questions while keeping device control
on the ESP32 transport path.

## ESP32 Transport Notes

The frontend talks to the ESP32 directly from the browser.

- HTTP transport implementation: [src/integrations/esp32/httpTransport.js](src/integrations/esp32/httpTransport.js)
- WebSocket transport implementation: [src/integrations/esp32/websocketTransport.js](src/integrations/esp32/websocketTransport.js)
- Feedback parser: [src/utils/jarvis.js](src/utils/jarvis.js)

For HTTP transport, your ESP32 firmware must support CORS and `OPTIONS`.

### Provider Notes

The backend supports both direct OpenAI API keys and OpenRouter API keys.

- For OpenAI, use `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.
- For OpenRouter, use `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL`.
- You can also set `AI_PROVIDER=openrouter` or `AI_PROVIDER=openai` to force a provider.
- If `AI_PROVIDER` is not set, the backend auto-detects OpenRouter-style keys
  and routes requests to `https://openrouter.ai/api/v1`.
