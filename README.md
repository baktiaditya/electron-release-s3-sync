Forked version from [Timer/electron-release-s3-sync](https://github.com/Timer/electron-release-s3-sync)

Support `AWS_ACCESS_KEY_ID` & `AWS_SECRET_KEY` (.env).

Install:
```
$ yarn add bvap-electron-release-s3-sync --dev
- or -
$ npm i bvap-electron-release-s3-sync --save-dev
```

Then add to your package.json scripts like, `"sync": "env-cmd .env bvap-electron-release-s3-sync"`.
