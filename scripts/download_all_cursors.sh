#!/bin/bash

# Check if a JSON file is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <json_file> [force]"
    echo "Example: $0 versions.json"
    echo "Example (force mode): $0 versions.json force"
    exit 1
fi

JSON_FILE=$1
FORCE_DOWNLOAD=false
if [ "$2" == "force" ]; then
    FORCE_DOWNLOAD=true
    echo "Force mode enabled. Will re-download and process all found Linux versions."
fi

# Ensure the JSON file exists
if [ ! -f "$JSON_FILE" ]; then
    echo "Error: JSON file '$JSON_FILE' does not exist."
    exit 1
fi

# Ensure the download script exists and is executable
DOWNLOAD_SCRIPT="scripts/get_cursor_product_json.sh"
if [ ! -f "$DOWNLOAD_SCRIPT" ] || [ ! -x "$DOWNLOAD_SCRIPT" ]; then
    echo "Error: The download script '$DOWNLOAD_SCRIPT' does not exist or is not executable."
    echo "Please ensure 'get_cursor_product_json.sh' is in the current directory and has execute permissions."
    exit 1
fi

echo "Parsing '$JSON_FILE' file..."
echo "-----------------------------------"

# Use jq to iterate through the versions in the JSON
# Filter for objects that have a "linux-x64" platform
jq -c '.versions[] | select(.platforms."linux-x64" != null)' "$JSON_FILE" | while read -r version_obj; do
    
    # Extract the version number and Linux URL from the JSON object
    VERSION=$(echo "$version_obj" | jq -r '.version')
    LINUX_URL=$(echo "$version_obj" | jq -r '.platforms."linux-x64"')
    
    OUTPUT_FILE="cursor_products/${VERSION}/product.json"

    # Check if the product.json file already exists, unless force mode is enabled
    if [ "$FORCE_DOWNLOAD" = false ] && [ -f "$OUTPUT_FILE" ]; then
        echo "Product.json for version $VERSION already exists. Skipping."
        continue
    fi

    echo "Processing version: $VERSION"
    echo "Download URL: $LINUX_URL"

    # Call the download script and check its exit status
    if ! "$DOWNLOAD_SCRIPT" "$LINUX_URL"; then
        echo "Failed to process version $VERSION. Please check the output of the download script."
    else
        echo "Successfully processed version $VERSION."
    fi
    echo "-----------------------------------"
done

echo "Finished processing all specified versions."