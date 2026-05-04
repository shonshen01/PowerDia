/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

// Import file, libraries and plugins
const path = require('path');
const webpack = require('webpack');
const sourceDir = __dirname + '/pgadmin/static';
// webpack.shim.js contains path references for resolve > alias configuration
// and other util function used in CommonsChunksPlugin.
const webpackShimConfig = require('./webpack.shim');
const PRODUCTION = process.env.NODE_ENV === 'development';
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const extractStyle = new MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[name].css',
});
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const CopyPlugin = require('copy-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');

let isSharpAvailable = true;
try {
  const sharp = require('sharp');
  // It is possible that sharp is installed but fails on running
  sharp();
} catch {
  isSharpAvailable = false;
  console.warn('Sharp is not available, image optimization will be disabled.');
}

const envType = PRODUCTION ? 'production': 'development';
const devToolVal = PRODUCTION ? false : 'eval-source-map';
const analyzerMode = process.env.ANALYZE=='true' ? 'static' : 'disabled';

const outputPath = __dirname + '/pgadmin/static/js/generated';

// Expose libraries in app context so they need not to
// require('libname') when used in a module
const providePlugin = new webpack.ProvidePlugin({
  _: 'lodash',
  pgAdmin: 'sources/pgadmin',
  'moment': 'moment',
  'window.moment':'moment',
  process: 'process/browser',
  Buffer: ['buffer', 'Buffer'],
});

// Helps in debugging each single file, it extracts the module files
// from bundle so that they are accessible by search in Chrome's sources panel.
// Reference: https://webpack.js.org/plugins/source-map-dev-tool-plugin/#components/sidebar/sidebar.jsx
const sourceMapDevToolPlugin = new webpack.SourceMapDevToolPlugin({
  filename: '[name].js.map',
  exclude: /(vendor|codemirror|pgadmin\.js|pgadmin.theme|pgadmin.static|style\.js|popper)/,
  columns: false,
});

// can be enabled using bundle:analyze
const bundleAnalyzer = new BundleAnalyzerPlugin({
  analyzerMode: analyzerMode,
  reportFilename: 'analyze_report.html',
});

const copyFiles = new CopyPlugin({
  patterns: [
    {
      from: './pgadmin/static/img/*.png',
      to: 'img/[name][ext]',
    },
  ],
});

module.exports = [{
  mode: envType,
  devtool: devToolVal,
  stats: { children: false, builtAt: true, chunks: true, timings: true },
  // The base directory, an absolute path, for resolving entry points and loaders
  // from configuration.
  context: __dirname,
  // Specify entry points of application
  entry: {
    'app.bundle': sourceDir + '/bundle/app.js',
    'security.pages': 'security.pages',
    sqleditor: './pgadmin/tools/sqleditor/static/js/index.js',
    erd_tool: './pgadmin/tools/erd/static/js/index.js',
    style: ['./pgadmin/static/css/style.css', './pgadmin/static/js/pgadmin.fonticon.js']
  },
  // path: The output directory for generated bundles(defined in entry)
  // Ref: https://webpack.js.org/configuration/output/#output-library
  output: {
    libraryTarget: 'amd',
    path: outputPath,
    filename: '[name].js',
    chunkFilename: '[name].chunk.js?id=[chunkhash]',
    libraryExport: 'default',
    publicPath: '',
  },
  // Templates files which contains python code needs to load dynamically
  // Such files specified in externals are loaded at first and defined in
  // the start of generated bundle within define(['libname'],fn) etc.
  externals: webpackShimConfig.externals,
  module: {
    // References:
    // Module and Rules: https://webpack.js.org/configuration/module/
    // Loaders: https://webpack.js.org/loaders/
    //
    // imports-loader: it adds dependent modules(use:imports-loader?module1)
    // at the beginning of module it is dependency.
    // It solves number of problems
    // Ref: http:/github.com/webpack-contrib/imports-loader/
    rules: [{
      test: /\.fonticon\.js/,
      use: [
        MiniCssExtractPlugin.loader,
        {
          loader: 'css-loader',
          options: {
            url: false,
          },
        },
        'webfonts-loader',
      ],
    }, {
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false
      },
    }, {
      test: /\.tsx?$|\.ts?$|\.jsx?$/,
      exclude: [/node_modules/, /vendor/],
      use: {
        loader: 'babel-loader',
        options: {
          presets: [['@babel/preset-env', { 'modules': 'commonjs', 'useBuiltIns': 'usage', 'corejs': 3 }], ['@babel/preset-react', {
            'runtime': 'automatic'
          }], '@babel/preset-typescript'],
          plugins: ['@babel/plugin-proposal-class-properties', '@babel/proposal-object-rest-spread'],
        },
      },
    }, {
      test: /external_table.*\.js/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: [['@babel/preset-env', {'modules': 'commonjs', 'useBuiltIns': 'usage', 'corejs': 3}]],
        },
      },
    }, {
      // Transforms the code in a way that it works in the webpack environment.
      // It uses imports-loader internally to load dependency. Its
      // configuration is specified in webpack.shim.js
      // Ref: https://www.npmjs.com/package/shim-loader
      test: /\.js/,
      exclude: [/external_table/],
      loader: 'shim-loader',
      options: webpackShimConfig,
      include: path.join(__dirname, '/pgadmin/browser'),
    }, {
      // imports-loader: it adds dependent modules(use:imports-loader?module1)
      // at the beginning of module it is dependency.
      // It solves number of problems
      // Ref: http:/github.com/webpack-contrib/imports-loader/
      test: require.resolve('./pgadmin/tools/sqleditor/static/js/index'),
      use: {
        loader: 'imports-loader',
        options: {
          type: 'commonjs',
          imports: [
            'pure|pgadmin.tools.user_management',
            'pure|pgadmin.browser.bgprocessmanager',
            'pure|pgadmin.node.server_group',
            'pure|pgadmin.node.server',
            'pure|pgadmin.node.database',
            'pure|pgadmin.node.schema',
            'pure|pgadmin.node.table',
            'pure|pgadmin.node.column',
          ],
        },
      },
    },{
      test: require.resolve('./pgadmin/static/bundle/browser'),
      use: {
        loader: 'imports-loader',
        options: {
          type: 'commonjs',
          imports: [
            'pure|pgadmin.preferences',
            'pure|pgadmin.settings',
            'pure|pgadmin.tools.search_objects',
            'pure|pgadmin.tools.erd',
            'pure|pgadmin.tools.sqleditor',
            'pure|pgadmin.tools.user_management',
          ],
        },
      },
    },
    {
      test: /\.svg$/,
      oneOf: [
        {
          issuer: /\.[jt]sx?$/,
          resourceQuery: /svgr/,
          use: ['@svgr/webpack'],
        },
        {
          type: 'asset',
          parser: {
            dataUrlCondition: {
              maxSize: 4 * 1024, // 4kb
            }
          }
        },
      ],
    },{
      test: /\.(jpe?g|png|gif)$/i,
      type: 'asset',
      parser: {
        dataUrlCondition: {
          maxSize: 4 * 1024, // 4kb
        },
      },
      generator: {
        filename: 'img/[name].[ext]',
      },
      exclude: /vendor/,
    },{
      test: /\.(eot|ttf|woff|woff2)$/,
      type: 'asset/resource',
      generator: {
        filename: 'fonts/[name].[ext]',
      },
      include: [
        /node_modules/,
        path.join(sourceDir, '/css/'),
        path.join(sourceDir, '/fonts/'),
      ],
      exclude: /vendor/,
    },
    {
      test: /\.css$/,
      use: [
        {
          loader: MiniCssExtractPlugin.loader,
          options: {
            publicPath: '',
          },
        },
        'css-loader',
        {
          loader: 'postcss-loader',
          options: {
            postcssOptions: () =>({
              plugins: [
                require('autoprefixer')(),
              ],
            }),
          },
        },
      ],
    }],
    // Prevent module from parsing through webpack, helps in reducing build time
    noParse: [/moment.js/],
  },
  resolve: {
    alias: webpackShimConfig.resolveAlias,
    modules: ['node_modules', '.'],
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    unsafeCache: true,
    fallback: {
      'fs': false
    },
  },
  // Watch mode Configuration: After initial build, webpack will watch for
  // changes in files and compiles only files which are changed,
  // if watch is set to True
  // Reference: https://webpack.js.org/configuration/watch/#components/sidebar/sidebar.jsx
  watchOptions: {
    aggregateTimeout: 300,
    poll: 1000,
    ignored: /node_modules/,
  },
  optimization: {
    minimizer: PRODUCTION ? [
      new TerserPlugin({
        parallel: false,
        extractComments: true,
        terserOptions: {
          compress: true,
        },
      }),
    ].concat(isSharpAvailable ? [
      new ImageMinimizerPlugin({
        test: /\.(jpe?g|png|gif)$/i,
        minimizer: {
          implementation: ImageMinimizerPlugin.sharpMinify,
          options: {
            encodeOptions: {
              jpeg: {
                quality: 100,
              },
              webp: {
                lossless: true,
              },
              avif: {
                lossless: true,
              },
              png: {},
              gif: {},
            },
          },
        },
      }),
    ] : []) : [],
    splitChunks: {
      cacheGroups: {
        vendor_sqleditor: {
          name: 'vendor_sqleditor',
          filename: 'vendor.sqleditor.js',
          chunks: 'all',
          reuseExistingChunk: true,
          priority: 9,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.matchModules(module, ['jsoneditor', 'leaflet']);
          },
        },
        vendor_react: {
          name: 'vendor_react',
          filename: 'vendor.react.js',
          chunks: 'all',
          reuseExistingChunk: true,
          priority: 8,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.matchModules(module, ['react', 'react-dom']);
          },
        },
        vendor_main: {
          name: 'vendor_main',
          filename: 'vendor.main.js',
          chunks: 'all',
          reuseExistingChunk: true,
          priority: 7,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.matchModules(module, ['codemirror', 'rc-', '@mui']);
          },
        },
        vendor_others: {
          name: 'vendor_others',
          filename: 'vendor.others.js',
          chunks: 'all',
          reuseExistingChunk: true,
          priority: 6,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.isExternal(module);
          },
        },
        secondary: {
          name: 'pgadmin_commons',
          filename: 'pgadmin_commons.js',
          chunks: 'all',
          priority: 5,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.isPgAdminLib(module);
          },
        },
        browser_nodes: {
          name: 'browser_nodes',
          filename: 'browser_nodes.js',
          chunks: 'all',
          priority: 4,
          minChunks: 2,
          enforce: true,
          test(module) {
            return webpackShimConfig.isBrowserNode(module);
          },
        },
      },
    },
  },
  // Define list of Plugins used in Production or development mode
  // Ref:https://webpack.js.org/concepts/plugins/#components/sidebar/sidebar.jsx
  plugins: PRODUCTION ? [
    extractStyle,
    providePlugin,
    sourceMapDevToolPlugin,
    bundleAnalyzer,
    copyFiles,
  ]: [
    extractStyle,
    providePlugin,
    sourceMapDevToolPlugin,
    copyFiles,
  ],
}];
