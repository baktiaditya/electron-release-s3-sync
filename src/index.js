#!/usr/bin/env node

const co = require('co');
const progress = require('request-progress');
const request = require('request');
const ProgressBar = require('progress');
const collect = require('collect-json');
const nodeUrl = require('url');
const { getLatest: cbGetLatest } = require('ghreleases');

const {
  GH_USER,
  GH_TOKEN,
  GH_ORG,
  GH_REPO,
  AWS_BUCKET,
  AWS_BUCKET_URL: _AWS_BUCKET_URL,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_KEY,
} = process.env;

const getLatest = (auth, org, repo, options) => {
  return new Promise(function(resolve, reject) {
    const callback = (err, release) => {
      if (err) reject(err);
      else resolve(release);
    };
    cbGetLatest(auth, org, repo, options || {}, callback);
  });
};

const AWS = require('aws-sdk');
AWS.config.update({ accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_KEY });
const s3 = require('s3-upload-stream')(new AWS.S3());

const AWS_BUCKET_URL =
  _AWS_BUCKET_URL == null ? null :
    _AWS_BUCKET_URL.endsWith('/') ?
      _AWS_BUCKET_URL :
      `${AWS_BUCKET_URL}/`;

if (GH_USER == null || GH_TOKEN == null) {
  throw new Error('You must specify both GH_USER and GH_TOKEN in the env.');
}

if (GH_ORG == null || GH_REPO == null) {
  throw new Error('You must specify both GH_ORG and GH_REPO in the env.');
}

if (AWS_BUCKET == null || AWS_BUCKET_URL == null) {
  throw new Error('You must specify the AWS bucket and bucket URL you are uploading to.');
}

if (AWS_ACCESS_KEY_ID == null || AWS_SECRET_KEY == null) {
  throw new Error('You must specify the AWS access key id and secret key.');
}

function sync(options = {}) {
  return co(function* () {
    const { assets } = yield getLatest({
      user: GH_USER,
      token: GH_TOKEN,
    }, GH_ORG, GH_REPO, options);

    const resources = [];
    for (const asset of assets) {
      const {
        name, url,
      } = asset;
      resources.push({ name, url });
    }
    resources.sort(({ name: a }, { name: b }) => {
      const _a = a.toUpperCase().includes('LATEST'),
        _b = b.toUpperCase().includes('LATEST');
      if (_a == _b) return 0;
      if (_a && !_b) return 1;
      return -1;
    });
    console.log('Identified resources:', resources);
    for (const resource of resources) {
      const { name, url } = resource;
      const r = progress(request({
        method: 'GET',
        uri: url,
        headers: {
          'Accept': 'application/octet-stream',
          'User-Agent': 'electron-release-sync',
        },
        auth: {
          user: GH_USER,
          pass: GH_TOKEN,
          sendImmediately: true,
        },
      }));
      const promise_r = new Promise(function(resolve, reject) {
        let rejected = false;
        r.once('error', err => {
          rejected = true;
          reject(err);
        });
        r.once('end', () => {
          if (!rejected) resolve();
        });
      });
      const bar = new ProgressBar(`Uploading ${name} (:size MB) [:bar] :percent eta: :etas (:speed MB/sec)`, {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 100,
        clear: false,
      });
      r.on('progress', state => {
        const { percent, speed, size: { total: size } } = state;
        bar.update(percent, {
          speed: (speed / 1024 / 1024).toFixed(2),
          size: (size / 1024 / 1024).toFixed(2),
        });
      });
      r.once('end', () => bar.terminate());
      let s3_pipe = r;
      if (name.toUpperCase().endsWith('JSON')) {
        s3_pipe = s3_pipe.pipe(collect(json => {
          const file = json.url.substring(json.url.lastIndexOf('/') + 1);
          json = Object.assign({}, json, {
            url: nodeUrl.parse(AWS_BUCKET_URL).resolve(file),
          });
          return JSON.stringify(json, null, 2);
        }));
      }
      s3_pipe.pipe(s3.upload({
        'Bucket': AWS_BUCKET,
        'Key': name,
      }));
      yield promise_r;
      console.log(`Uploaded ${name}.`);
    }
    console.log('Uploaded assets.');
    return resources;
  });
}

sync().catch(e => {
  console.log('err:', e);
  process.exit(1);
});
