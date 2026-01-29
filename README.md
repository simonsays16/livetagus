# LiveTagus

**LiveTagus** is an independent, open-source web interface designed to help commuters in the Lisbon South Bay area track **Fertagus** trains in real-time.

> **Note:** LiveTagus is an independent project and is **not affiliated, associated, authorized, endorsed by, or in any way officially connected with Fertagus not Infraestruturas de Portugal (IP)**. The official Fertagus website can be found at [fertagus.pt](https://www.fertagus.pt). The official IP website can be found at [infraestruturasdeportugal.pt](https://www.infraestruturasdeportugal.pt/).

## Live Demo

Visit the app: [**https://livetagus.pt**](https://livetagus.pt)

---

## Important Note about the API

Although the API code is open-source and available for review, we kindly ask that you do not use our production endpoint for your own projects or applications.

Maintaining the servers involves costs that are covered by us. High external traffic to our API increases these costs and risks service instability for users of the official application. If you need API functionality for other purposes, please self-host it using the code provided in the **/API** folder.
## Project Structure

The repository is organized as follows:

* **/WebApp**: Contains the Frontend source code (main focus).
    * HTML, Javascript, and CSS.
    * Styling with Tailwind CSS.
    * PWA Configuration.
* **/API**: Backend source code (provided for reference and self-hosting purposes only).
    * Node.js Server.
    * Static JSON files.

## How to run locally

To test or develop the project on your machine:

### Prerequisites
* Node.js installed.

### 1. Setup API (Backend)
If you need to modify data or server logic:

```bash
cd API
npm install
node index.js
# The server should start
```

### 2. Setup WebApp (Frontend)
The WebApp uses Tailwind CSS. To compile CSS and see changes:

```bash
cd WebApp
npm install
# To start the Tailwind watch process (automatic compilation):
npm run watch
```

Then, simply open the `index.html` or `app.html` file in your browser.
## Features

* **Schedules:** Quick check for upcoming trains.
* **Service Status:** Information regarding delays or cancellations.
* **PWA:** Can be installed on mobile devices as a native application.
* **Design:** Mobile-optimized interface.

## Contributing

Contributions are welcome. If you found a bug or have a suggestion:

1. Fork the project.
2. Create a Branch for your feature (`git checkout -b feature/NovaFuncionalidade`).
3. Commit your changes (`git commit -m 'Adiciona NovaFuncionalidade'`).
4. Push to the Branch (`git push origin feature/NovaFuncionalidade`).
5. Open a Pull Request.

Please review our [Code of Conduct](https://github.com/simonsays16/livetagus/blob/main/CODE_OF_CONDUCT.md) before contributing.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/simonsays16/livetagus/blob/main/LICENSE) file for details.

## Disclaimer
LiveTagus is an independent project and is **not affiliated, associated, authorized, endorsed by, or in any way officially connected with Fertagus**. The official Fertagus website can be found at [fertagus.pt](https://www.fertagus.pt).

---
<img src="https://livetagus.pt/imagens/badge_coded_in_europe_portugal_margem_sul.svg" alt="Coded in Europe | Portugal | Margem Sul" width="150"/>

Developed with ❤️ in Margem Sul.
