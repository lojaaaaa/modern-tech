FROM onlyoffice/documentserver:9.4.0.1@sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212

# ColorPaletteExt uses Common.UI.BaseView synchronously but omits its AMD
# dependency. Refuse to patch any different upstream build.
RUN set -eu; \
    cd /var/www/onlyoffice/documentserver/web-apps/apps/common/main/lib/component; \
    echo '9d92f386284e2f226e9e24455eb70b7020edac0aec5c175a8d4e92633dc0145c  ColorPaletteExt.js' | sha256sum -c -; \
    test "$(grep -Fc 'define([], function () {' ColorPaletteExt.js)" = 1; \
    sed -i "s@define(\[\], function () {@define(['common/main/lib/component/BaseView'], function () {@" ColorPaletteExt.js; \
    gzip -n -c ColorPaletteExt.js > ColorPaletteExt.js.gz; \
    gzip -dc ColorPaletteExt.js.gz | cmp - ColorPaletteExt.js
