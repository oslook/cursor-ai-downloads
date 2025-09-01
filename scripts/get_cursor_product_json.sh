#!/bin/bash

# Check if a complete URL is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <full_appimage_download_url>"
    echo "Example: $0 https://downloads.cursor.com/production/.../Cursor-1.5.9-x86_64.AppImage"
    exit 1
fi

DOWNLOAD_URL=$1
OUTPUT_DIR="cursor_products"
EXTRACT_DIR="temp_cursor_extract"

# Extract the filename from the URL
APPIMAGE_FILENAME=$(basename "$DOWNLOAD_URL")

# Extract the version number from the filename using a regular expression
VERSION=$(echo "$APPIMAGE_FILENAME" | sed -n 's/.*-\([0-9.]*\)-x86_64.AppImage/\1/p')

# Check if the version was successfully extracted
if [ -z "$VERSION" ]; then
    echo "Error: Could not parse version number from the filename. Please ensure the URL points to a valid AppImage file."
    exit 1
fi

echo "Attempting to download file: $APPIMAGE_FILENAME"
echo "Download URL: $DOWNLOAD_URL"
echo "Parsed Version: $VERSION"

# 1. Download the AppImage file
if ! wget --quiet --output-document="${APPIMAGE_FILENAME}" "$DOWNLOAD_URL"; then
    echo "Error: Download failed. Please check the URL or your network connection."
    rm -f "${APPIMAGE_FILENAME}"
    exit 1
fi

echo "Download complete."

# 2. Create a temporary directory for extracted files
mkdir -p "$EXTRACT_DIR"

# 3. Extract the AppImage file contents
echo "Extracting AppImage package..."
chmod +x "$APPIMAGE_FILENAME"
if ! ./"$APPIMAGE_FILENAME" --appimage-extract > /dev/null; then
    echo "Extraction failed. Attempting fallback with 'unsquashfs'."
    # Fallback method: using unsquashfs (requires squashfs-tools)
    if command -v unsquashfs &>/dev/null; then
        unsquashfs -f -d "$EXTRACT_DIR" "$APPIMAGE_FILENAME"
    else
        echo "Error: Fallback method 'unsquashfs' is not available. Please ensure 'squashfs-tools' is installed."
        rm -f "$APPIMAGE_FILENAME"
        rmdir "$EXTRACT_DIR" > /dev/null 2>&1
        exit 1
    fi
fi

# 4. Locate and copy the product.json file
# The extracted files are typically in a 'squashfs-root' directory
SOURCE_FILE="${EXTRACT_DIR}/squashfs-root/usr/share/cursor/resources/app/product.json"
if [ ! -f "$SOURCE_FILE" ]; then
    # In some cases, files might be extracted to the root of the temp directory
SOURCE_FILE="./squashfs-root/usr/share/cursor/resources/app/product.json"
fi

if [ -f "$SOURCE_FILE" ]; then
    mkdir -p "${OUTPUT_DIR}/${VERSION}"
    cp "$SOURCE_FILE" "${OUTPUT_DIR}/${VERSION}/product.json"
    echo "Successfully extracted and saved product.json for version ${VERSION}."
    echo "File location: ${OUTPUT_DIR}/${VERSION}/product.json"
else
    echo "Error: product.json file not found in the expected path inside the extracted AppImage."
fi

# 5. Clean up temporary files
rm -rf "$EXTRACT_DIR" "$APPIMAGE_FILENAME"
echo "Cleanup complete."
