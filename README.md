# Omnisend integration

Omnisend integration is an app for integrating with Omnisend.
It replicates all the functionality of native integration and can be adapted.

## Getting Started

You should install this app into your store

1. Clone this repository.
2. Install the Swell CLI.

```bash
npm install @swell/cli
```

3. Log in and install the app to your store.

```bash
cd /path/to/omnisend-integration

npm install

swell login

swell app push
```

install app to live environment
```bash
swell app version minor
swell app install
```

## Important note

In the "Apps" tab, select this app, and in the "Settings" tab, add Omnisend API Key and store url.
Make sure you've disabled the Omnisend integration, otherwise all events will be sent twice.

You can use "Developer" > "Console" > "Logs" to view the app's logs.

Currently, the app closely replicates Swell's integration with Omnisend.
You can adapt the app to your needs (support for additional events, additional fields,
add additional logging). After making changes, you can push, create a new version and install the app.

## Contributing

Contributions are welcome! Visit the [Swell Discord](https://discord.gg/VakSbyjDGZ) or [GitHub discussions](https://github.com/orgs/swellstores/discussions/) to get help and share ideas.

## License

This project is licensed under the MIT License - see [LICENSE.md](LICENSE.md) file for details.
