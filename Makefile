PROJECT="scratchpad-gist"
PWD=`pwd`
VERSION=`git describe --tags --dirty | tail -c +2`
XPI="${PWD}/build/${PROJECT}-${VERSION}.xpi"

.PHONY: xpi

xpi:
@echo "Building '${XPI}'..."
@mkdir -p build
@git archive --format=zip -o ${XPI} HEAD

