const path = require('path');
const webpack = require('webpack');

/** @typedef {import('webpack').Configuration} WebpackConfig **/
/** @type WebpackConfig */
const webExtensionConfig = {
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
  target: 'webworker', // extensions run in a webworker context
  entry: {
    extension: './extension.js', // source of the web extension main file
    'test/suite/index': './test/suite/index.js' // Source of web extension test runner.
  },
  output: {
    filename: '[name].js', // The name will be replaced with the key from the `entry` section i.e. by `extension` - because it is the only key in entry for this particular config.
    path: path.join(__dirname, './dist/web'),
    // devtoolModuleFilenameTemplate: '../../[resource-path]',
    libraryTarget: 'commonjs' // value from a fixed dictionary.
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'], // support ts-files and js-files
    alias: {
      // provides alternate implementation for node module and source files
    },
    fallback: {
      // Webpack 5 no longer polyfills Node.js core modules automatically.
      // see https://webpack.js.org/configuration/resolve/#resolvefallback
      // for the list of Node.js core module polyfills.
      // assert: require.resolve('assert')
      path: false,
      fs: false,
      os: false,
      child_process: false,
      readline: false, // For read_header in rainbow_utils.js
      util: false // For util.TextDecoder in rbql_csv.js
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser' // provide a shim for the global `process` variable
    })
  ],
  externals: {
    vscode: 'commonjs vscode' // ignored because it doesn't exist
  },
  performance: {
    hints: false
  },
  devtool: 'nosources-source-map' // create a source map that points to the original source file
};
module.exports = [webExtensionConfig];
