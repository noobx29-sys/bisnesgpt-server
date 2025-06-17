<?php

// Enqueue Styles and Scripts
add_action('wp_enqueue_scripts', 'bootscore_child_enqueue_styles');
function bootscore_child_enqueue_styles() {
    wp_enqueue_style('parent-style', get_template_directory_uri() . '/style.css');
    $modified_bootscoreChildCss = date('YmdHi', filemtime(get_stylesheet_directory() . '/css/main.css'));
    wp_enqueue_style('main', get_stylesheet_directory_uri() . '/css/main.css', array('parent-style'), $modified_bootscoreChildCss);
    wp_enqueue_script('custom-js', get_stylesheet_directory_uri() . '/js/custom.js', array('jquery'), null, true);
}

// Include Widgets and Breadcrumbs
include get_stylesheet_directory() . '/func/footer-widgets.php';
include get_stylesheet_directory() . '/func/breadcrumb.php';

// Add AJAX handlers
add_action('wp_ajax_calculate_lalamove_price', 'calculate_lalamove_price');
add_action('wp_ajax_nopriv_calculate_lalamove_price', 'calculate_lalamove_price');

function calculate_lalamove_price() {
    error_log('=== Starting Price Calculation ===');
    
    // Get form data
    $storage_space = $_POST['storage_space'] ?? '';
    $storage_duration = intval(str_replace('_month', '', $_POST['storage_duration'])) ?? 1;
    $need_lorry = filter_var($_POST['need_lorry'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $need_wrapping = filter_var($_POST['need_wrapping'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $need_manpower = filter_var($_POST['need_manpower'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $vehicle_type = strtolower($_POST['vehicle_type'] ?? 'van');
    
    // Get storage pricing from API
    $pricing_response = wp_remote_get('https://juta.ngrok.app/api/storage-pricing');
    $pricing_data = [];
    $price_per_sqft = 0;
    
    if (!is_wp_error($pricing_response)) {
        $pricing_body = wp_remote_retrieve_body($pricing_response);
        $pricing_data = json_decode($pricing_body, true);
        
        if ($pricing_data && isset($pricing_data['data']['data'])) {
            // Determine duration range
            $duration_range = '1 - 2';
            if ($storage_duration >= 3 && $storage_duration <= 5) {
                $duration_range = '3 - 5';
            } elseif ($storage_duration >= 6 && $storage_duration <= 11) {
                $duration_range = '6 - 11';
            } elseif ($storage_duration >= 12) {
                $duration_range = '> 12';
            }
            
            // Get space range for pricing
            $space_range = get_space_range($storage_space);
            
            // Find matching price
            foreach ($pricing_data['data']['data'] as $price) {
                if ($price['size'] === $space_range && $price['duration'] === $duration_range) {
                    $price_per_sqft = $price['priceAfterDiscount'];
                    break;
                }
            }
        }
    }
    
    // Calculate storage costs
    $space_numeric = intval($storage_space); // Use actual input value
    $monthly_rental = $price_per_sqft * $space_numeric;
    $security_deposit = $monthly_rental; // Equal to one month's rental
    $rental_cost = $monthly_rental * $storage_duration;
    
    // Initialize additional service fees
    $lorry_fee = 0;
    $wrapping_items = intval($_POST['wrapping_items'] ?? 0);
    $wrapping_fee = $need_wrapping ? (20 * $wrapping_items) : 0;

    
    // Get Lalamove price if lorry service is needed
    if ($need_lorry) {
        $api_url = add_query_arg(
            array(
                'user_latitude' => $_POST['user_latitude'] ?? '',
                'user_longitude' => $_POST['user_longitude'] ?? '',
                'pickup_street' => $_POST['pickup_street'] ?? '',
                'pickup_city' => $_POST['pickup_city'] ?? '',
                'pickup_state' => $_POST['pickup_state'] ?? '',
                'pickup_postcode' => $_POST['pickup_postcode'] ?? '',
                'store_location' => strtolower($_POST['store_location'] ?? ''),
                'vehicle_type' => $vehicle_type,
                'manpower' => $need_manpower ? 'true' : 'false'
            ),
            'https://juta.ngrok.app/api/lalamove/quote'
        );

        error_log('Calling Lalamove API: ' . $api_url);
        
        $response = wp_remote_get($api_url);
        
        if (!is_wp_error($response)) {
            $body = wp_remote_retrieve_body($response);
            error_log('Lalamove API Response: ' . $body);
            
            $data = json_decode($body, true);
            if ($data && isset($data['data']['totalFee']['amount'])) {
                $lorry_fee = floatval($data['data']['totalFee']['amount']);
            }
        }
    }
    
    // Calculate total
    $admin_fee = 30;
    $stamping_fee = 10;
    $total = $rental_cost + $security_deposit + $admin_fee + $stamping_fee + $lorry_fee + $wrapping_fee;
    
    // Prepare response
    $response_data = array(
        'monthly_rental' => number_format($monthly_rental, 2),
        'security_deposit' => number_format($security_deposit, 2),
        'rental_cost' => number_format($rental_cost, 2),
        'admin_fee' => number_format($admin_fee, 2),
        'stamping_fee' => number_format($stamping_fee, 2),
        'lorry_fee' => number_format($lorry_fee, 2),
        'wrapping_fee' => number_format($wrapping_fee, 2),
        'total' => number_format($total, 2)
    );
    
    error_log('Calculated fees: ' . print_r($response_data, true));
    
    wp_send_json_success($response_data);
}

// Helper functions for calculations
function calculate_monthly_rental($space) {
    $base_rates = array(
        '50' => 200,
        '100' => 350,
        '200' => 600,
        '500' => 1200
    );
    return $base_rates[$space] ?? 0;
}

function calculate_security_deposit($space) {
    return calculate_monthly_rental($space);
}



// Inline JS for Form Steps
function add_inline_storage_form_js() {
    wp_enqueue_script("jquery");
    wp_add_inline_script("jquery", "
        document.addEventListener('DOMContentLoaded', function () {
            // Initialize variables
            const steps = document.querySelectorAll(\".step\");
            const stepContents = document.querySelectorAll(\".step-content\");
            const nextStepButtons = document.querySelectorAll(\".next-step\");
            const prevStepButtons = document.querySelectorAll(\".prev-step\");
            let currentStep = 0;

            // Get all service-related elements
            const needLorryCheckbox = document.getElementById(\"need_lorry\");
            const movingServicesOptions = document.getElementById(\"moving-services-options\");
            const needWrappingCheckbox = document.getElementById(\"need_wrapping\");
            const needManpowerCheckbox = document.getElementById(\"need_manpower\");
            const vehicleTypeSection = document.getElementById(\"vehicle-type-section\");
            const pickupAddressSection = document.getElementById(\"pickup-address-section\");
            const wrappingItemsSection = document.getElementById(\"wrapping-items-section\");

            // Function to show step
            function showStep(stepIndex) {
                if (stepIndex < 0 || stepIndex >= steps.length) return;

                steps.forEach((step, index) => {
                    step.classList.toggle('active', index === stepIndex);
                });

                stepContents.forEach((content, index) => {
                    content.style.display = index === stepIndex ? 'block' : 'none';
                });

                currentStep = stepIndex;
            }

            // Function to update visibility of additional services
            function updateServiceVisibility() {
                console.log('Updating service visibility');
                
                // Show/hide moving services options
                const showMovingServices = needLorryCheckbox.checked;
                movingServicesOptions.style.display = showMovingServices ? 'block' : 'none';
                
                if (showMovingServices) {
                    // Show vehicle and address sections when lorry is selected
                    vehicleTypeSection.style.display = 'block';
                    pickupAddressSection.style.display = 'block';
              
                } else {
                    // Hide all related sections when lorry is unselected
                    vehicleTypeSection.style.display = 'none';
                    pickupAddressSection.style.display = 'none';
                    needManpowerCheckbox.checked = false;
                    needWrappingCheckbox.checked = false;
                    wrappingItemsSection.style.display = 'none';
                }

                // Show/hide wrapping items section
                if (needWrappingCheckbox) {
                    wrappingItemsSection.style.display = needWrappingCheckbox.checked ? 'block' : 'none';
                }

                // Update fee display rows
                const lorryFeeRow = document.querySelector('.lorry-fee-row');
                const wrappingFeeRow = document.querySelector('.wrapping-fee-row');
           

                if (lorryFeeRow) lorryFeeRow.style.display = needLorryCheckbox.checked ? 'flex' : 'none';
                if (wrappingFeeRow) wrappingFeeRow.style.display = needWrappingCheckbox.checked ? 'flex' : 'none';
              
            }

            // Event listeners for checkboxes
            if (needLorryCheckbox) {
                needLorryCheckbox.addEventListener('change', updateServiceVisibility);
            }
            if (needWrappingCheckbox) {
                needWrappingCheckbox.addEventListener('change', updateServiceVisibility);
            }
            if (needManpowerCheckbox) {
                needManpowerCheckbox.addEventListener('change', function() {
                    const manpowerFeeRow = document.querySelector('.manpower-fee-row');
                    if (manpowerFeeRow) {
                        manpowerFeeRow.style.display = this.checked ? 'flex' : 'none';
                    }
                });
            }
 // Add vehicle type selection logging
        const vehicleSelect = document.querySelector('select[name=\"vehicle_type\"]');
        if (vehicleSelect) {
            vehicleSelect.addEventListener('change', function() {
                console.log('Vehicle Selected:');
                console.log('- Value:', this.value);
                console.log('- Selected Option:', this.options[this.selectedIndex].text);
            });
        }
            // Add event listener for wrapping items input
const wrappingItemsInput = document.querySelector('input[name=\"wrapping_items\"]');
if (wrappingItemsInput) {
    wrappingItemsInput.addEventListener('change', fetchLalamovePrice);
}
            // Lalamove price calculation function
            async function fetchLalamovePrice() {
                try {
                    const formData = new FormData();
                    formData.append('action', 'calculate_lalamove_price');
                    
                    // Get form values - Add null checks and default values
                    const storageSpaceInput = document.querySelector('input[name=\"storage_space\"]');
                    const storageDurationSelect = document.querySelector('select[name=\"storage_duration\"]');
                    
                    // Validate required form elements exist
                    if (!storageSpaceInput || !storageDurationSelect) {
                        console.error('Required form elements not found');
                        return;
                    }

                    const storageSpace = storageSpaceInput.value.trim();
                    // Validate that storage space is a number
                    if (!storageSpace || isNaN(storageSpace)) {
                        console.error('Invalid storage space value');
                        return;
                    }

                    const storageDuration = storageDurationSelect.value;
                    
                    // Validate required values
                    if (!storageSpace || !storageDuration) {
                        console.log('Storage space or duration not set');
                        return;
                    }

                    const needLorry = document.getElementById('need_lorry')?.checked || false;
                    const needWrapping = document.getElementById('need_wrapping')?.checked || false;
                    const needManpower = document.getElementById('need_manpower')?.checked || false;
                    const vehicleType = document.querySelector('select[name=\"vehicle_type\"]')?.value || 'van';
                    const storeLocation = document.querySelector('select[name=\"store_location\"]')?.value?.toLowerCase() || '';
                    const wrappingItems = document.querySelector('input[name=\"wrapping_items\"]')?.value || 0;

                    // Add all values to formData
                    formData.append('storage_space', storageSpace);
                    formData.append('storage_duration', storageDuration);
                    formData.append('need_lorry', needLorry);
                    formData.append('need_wrapping', needWrapping);
                    formData.append('need_manpower', needManpower);
                    formData.append('vehicle_type', vehicleType);
                    formData.append('wrapping_items', wrappingItems);
                    
                    // Get user's current location
                    try {
                        const position = await new Promise((resolve, reject) => {
                            navigator.geolocation.getCurrentPosition(resolve, reject);
                        });
                        
                        formData.append('user_latitude', position.coords.latitude);
                        formData.append('user_longitude', position.coords.longitude);
                    } catch (error) {
                        console.error('Error getting location:', error);
                        // Default to KL coordinates if geolocation fails
                        formData.append('user_latitude', '3.1390');
                        formData.append('user_longitude', '101.6869');
                    }
                    
                    // Get address details
                    const pickupStreet = document.querySelector('input[name=\"pickup_street\"]')?.value || '';
                    const pickupCity = document.querySelector('input[name=\"pickup_city\"]')?.value || '';
                    const pickupState = document.querySelector('input[name=\"pickup_state\"]')?.value || '';
                    const pickupPostcode = document.querySelector('input[name=\"pickup_postcode\"]')?.value || '';
                    
                    // Add all values to formData
                    formData.append('storage_space', storageSpace);
                    formData.append('storage_duration', storageDuration);
                    formData.append('need_lorry', needLorry);
                    formData.append('need_wrapping', needWrapping);
                    formData.append('need_manpower', needManpower);
                    formData.append('vehicle_type', vehicleType);
                    formData.append('pickup_street', pickupStreet);
                    formData.append('pickup_city', pickupCity);
                    formData.append('pickup_state', pickupState);
                    formData.append('pickup_postcode', pickupPostcode);
                    formData.append('store_location', storeLocation);
                    
                    // Log the data being sent
                    console.log('Sending Form Data:');
                    console.log('- Vehicle Type:', vehicleType);
                    console.log('- Store Location:', storeLocation);
                    console.log('- Need Manpower:', needManpower);
                    console.log('- Pickup Address:', {
                        street: pickupStreet,
                        city: pickupCity,
                        state: pickupState,
                        postcode: pickupPostcode
                    });
                    
                    const response = await fetch('/wp-admin/admin-ajax.php', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error('HTTP error! status: ' + response.status);
                    }
                    
                    const data = await response.json();
                    console.log('WordPress response:', data);
                      console.log(vehicleType);
                    if (!data.success) {
                        throw new Error('Failed to calculate prices');
                    }
                    
                    // Update all fee displays
                    document.querySelector('.monthly-rental').textContent = 'RM' + data.data.monthly_rental;
                    document.querySelector('.security-deposit').textContent = 'RM' + data.data.security_deposit;
                    document.querySelector('.rental-cost').textContent = 'RM' + data.data.rental_cost;
                    document.querySelector('.admin-fee').textContent = 'RM' + data.data.admin_fee;
                    document.querySelector('.stamping-fee').textContent = 'RM' + data.data.stamping_fee;
                    document.querySelector('.lorry-fee').textContent = 'RM' + data.data.lorry_fee;
                    document.querySelector('.wrapping-fee').textContent = 'RM' + data.data.wrapping_fee;
                    document.querySelector('.total-amount').textContent = 'RM' + data.data.total;
                    
                    // Add hidden input to step3-form
                    const step3Form = document.getElementById('step3-form');
                    if (step3Form) {
                        let totalInput = step3Form.querySelector('input[name=\"total_amount\"]');
                        if (!totalInput) {
                            totalInput = document.createElement('input');
                            totalInput.type = 'hidden';
                            totalInput.name = 'total_amount';
                            step3Form.appendChild(totalInput);
                        }
                        totalInput.value = data.data.total;
                    }
                    
                } catch (error) {
                    console.error('Error calculating prices:', error);
                    console.error('Error stack:', error.stack);
                    
                    // Set default values in case of error
                    document.querySelector('.monthly-rental').textContent = 'RM0.00';
                    document.querySelector('.security-deposit').textContent = 'RM0.00';
                    document.querySelector('.rental-cost').textContent = 'RM0.00';
                    document.querySelector('.admin-fee').textContent = 'RM10.00';
                    document.querySelector('.stamping-fee').textContent = 'RM30.00';
                    document.querySelector('.lorry-fee').textContent = 'RM0.00';
                    document.querySelector('.wrapping-fee').textContent = 'RM0.00';
                    document.querySelector('.total-amount').textContent = 'RM40.00';
                    
                    // Add hidden input to step3-form with default value
                    const step3Form = document.getElementById('step3-form');
                    if (step3Form) {
                        let totalInput = step3Form.querySelector('input[name=\"total_amount\"]');
                        if (!totalInput) {
                            totalInput = document.createElement('input');
                            totalInput.type = 'hidden';
                            totalInput.name = 'total_amount';
                            step3Form.appendChild(totalInput);
                        }
                        totalInput.value = '40.00';
                    }
                }
            }

            // Add event listeners only if elements exist
            const storageSpaceInput = document.querySelector('input[name=\"storage_space\"]');
            const storageDurationSelect = document.querySelector('select[name=\"storage_duration\"]');

            if (storageSpaceInput) {
                storageSpaceInput.addEventListener('change', fetchLalamovePrice);
                storageSpaceInput.addEventListener('input', fetchLalamovePrice);
            }

            if (storageDurationSelect) {
                storageDurationSelect.addEventListener('change', fetchLalamovePrice);
            }

            // Add to the existing next button click handler
            nextStepButtons.forEach(button => {
                button.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const nextStep = currentStep + 1;
                    
                    // Validate current form before proceeding
                    const currentForm = document.querySelector(`.step-${currentStep + 1} form`);
                    if (currentForm) {
                        // Reset previous validation messages
                        const existingErrors = currentForm.querySelectorAll('.error-message');
                        existingErrors.forEach(error => error.remove());
                        
                        let isValid = true;
                        
                        // Step 1 specific validation
                        if (currentStep === 0) {
                            // Storage Type validation
                            const storageType = currentForm.querySelector('input[name="storage_type"]:checked');
                            if (!storageType) {
                                isValid = false;
                                addErrorMessage(currentForm.querySelector('input[name="storage_type"]'), 'Please select a storage type');
                            }
                            
                            // Salutation validation
                            const salutation = currentForm.querySelector('select[name="salutation"]');
                            if (salutation && salutation.value === "") {
                                isValid = false;
                                addErrorMessage(salutation, 'Please select a salutation');
                            }
                            
                            // Email validation
                            const email = currentForm.querySelector('input[name="email"]');
                            if (email && !isValidEmail(email.value)) {
                                isValid = false;
                                addErrorMessage(email, 'Please enter a valid email address');
                            }
                            
                            // Phone validation
                            const phone = currentForm.querySelector('input[name="phone"]');
                            if (phone && !isValidPhone(phone.value)) {
                                isValid = false;
                                addErrorMessage(phone, 'Please enter a valid phone number');
                            }
                            
                            // Storage Space validation
                            const storageSpace = currentForm.querySelector('input[name="storage_space"]');
                            if (storageSpace && (isNaN(storageSpace.value) || storageSpace.value <= 0)) {
                                isValid = false;
                                addErrorMessage(storageSpace, 'Please enter a valid storage space');
                            }
                            
                            // Storage Duration validation
                            const duration = currentForm.querySelector('select[name="storage_duration"]');
                            if (duration && duration.value === "") {
                                isValid = false;
                                addErrorMessage(duration, 'Please select a storage duration');
                            }
                            
                            // Store Location validation
                            const location = currentForm.querySelector('select[name="store_location"]');
                            if (location && location.value === "") {
                                isValid = false;
                                addErrorMessage(location, 'Please select a store location');
                            }
                        }
                        
                        // Step 2 specific validation
                        if (currentStep === 1) {
                            // Consent validation
                            const consent = currentForm.querySelector('input[name="consent"]:checked');
                            if (!consent) {
                                isValid = false;
                                addErrorMessage(currentForm.querySelector('input[name="consent"]'), 'Please select your consent preference');
                            }
                            
                            // Agreement validation
                            const agreement = currentForm.querySelector('input[name="agreement"]');
                            if (!agreement.checked) {
                                isValid = false;
                                addErrorMessage(agreement, 'You must agree to the terms and conditions');
                            }
                            
                            // Business fields validation if Business type selected
                            const storageType = document.querySelector('input[name="storage_type"]:checked');
                            if (storageType && storageType.value === 'Business') {
                                const businessName = currentForm.querySelector('input[name="business_name"]');
                                const regNo = currentForm.querySelector('input[name="company_reg_no"]');
                                
                                if (!businessName.value.trim()) {
                                    isValid = false;
                                    addErrorMessage(businessName, 'Please enter your business name');
                                }
                                if (!regNo.value.trim()) {
                                    isValid = false;
                                    addErrorMessage(regNo, 'Please enter your company registration number');
                                }
                            }
                        }
                        
                        // Step 3 specific validation
                        if (currentStep === 2) {
                            const storageType = document.querySelector('input[name="storage_type"]:checked');
                            
                            if (storageType.value === 'Personal') {
                                const icPassport = currentForm.querySelector('input[name="ic_or_passport"]');
                                if (!icPassport.files.length) {
                                    isValid = false;
                                    addErrorMessage(icPassport, 'Please upload your IC or Passport');
                                }
                            } else if (storageType.value === 'Business') {
                                const requiredDocs = ['form_9', 'form_49', 'directors_ic', 'form_24'];
                                requiredDocs.forEach(doc => {
                                    const input = currentForm.querySelector(`input[name="${doc}"]`);
                                    if (!input.files.length) {
                                        isValid = false;
                                        addErrorMessage(input, 'This document is required');
                                    }
                                });
                            }
                        }
                        
                        if (!isValid) {
                            return;
                        }
                    }
                    
                    // If validation passes, proceed with existing logic
                    if (currentStep === 0) {
                        try {
                            button.disabled = true;
                            button.textContent = 'Calculating...';
                            await fetchLalamovePrice();
                            if (nextStep < steps.length) {
                                showStep(nextStep);
                            }
                        } catch (error) {
                            console.error('Error during price calculation:', error);
                        } finally {
                            button.disabled = false;
                            button.textContent = 'Next';
                        }
                    } else {
                        if (nextStep < steps.length) {
                            showStep(nextStep);
                        }
                    }
                });
            });

            // Previous button handler
            prevStepButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    const prevStep = currentStep - 1;
                    if (prevStep >= 0) {
                        showStep(prevStep);
                    }
                });
            });

            // Initialize the form
            showStep(0);
            updateServiceVisibility();

            // Add storage type handling
            const storageTypeInputs = document.querySelectorAll('input[name=\"storage_type\"]');
            const businessFields = document.querySelectorAll('.business-fields');
            const personalFields = document.querySelectorAll('.personal-fields');
            
            // Function to handle storage type change
            function handleStorageTypeChange() {
                const selectedType = document.querySelector('input[name=\"storage_type\"]:checked').value;
                
                // Handle Step 2 business fields
                const step2BusinessFields = document.querySelectorAll('.step-2 .col-lg-12');
                step2BusinessFields.forEach(field => {
                    if (field.querySelector('[name=\"business_name\"], [name=\"company_reg_no\"]')) {
                        field.style.display = selectedType === 'Business' ? 'block' : 'none';
                    }
                });

                // Handle Step 3 fields
                businessFields.forEach(field => {
                    field.style.display = selectedType === 'Business' ? 'block' : 'none';
                });
                personalFields.forEach(field => {
                    field.style.display = selectedType === 'Personal' ? 'block' : 'none';
                });
            }

            // Add event listeners to storage type radio buttons
            storageTypeInputs.forEach(input => {
                input.addEventListener('change', handleStorageTypeChange);
            });

            // Initial check for storage type
            const initialStorageType = document.querySelector('input[name=\"storage_type\"]:checked');
            if (initialStorageType) {
                handleStorageTypeChange();
            }
        });
        ");
}
add_action("wp_enqueue_scripts", "add_inline_storage_form_js");

// WooCommerce Form Submission
// WooCommerce Form Submission
function handle_form_submission() {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $order = wc_create_order();
        
        // Create a simple virtual product programmatically
        $item = new WC_Order_Item_Product();
        $item->set_props(array(
            'name' => 'Storage Rental',
            'total' => floatval(str_replace(['RM', ','], '', $_POST['total_amount'])),
            'quantity' => 1
        ));
        $order->add_item($item);

        // Customer details
        $customer_details = array(
            'first_name' => sanitize_text_field($_POST['first_name']),
            'last_name'  => sanitize_text_field($_POST['last_name']),
            'email'      => sanitize_email($_POST['email']),
            'phone'      => sanitize_text_field($_POST['phone'])
        );

        $order->set_address($customer_details, 'billing');
        $order->calculate_totals();
        $order->update_status('pending', 'Awaiting payment');

        // Prepare email content
        $to = 'ferazfhansurei@gmail.com'; // Replace with your email address
        $subject = 'New Storage Rental Order #' . $order->get_order_number();
        
        $message = "New Storage Rental Order Details:\n\n";
        $message .= "Order #: " . $order->get_order_number() . "\n\n";
        
        // Customer Information
        $message .= "Customer Information:\n";
        $message .= "Name: " . $customer_details['first_name'] . ' ' . $customer_details['last_name'] . "\n";
        $message .= "Email: " . $customer_details['email'] . "\n";
        $message .= "Phone: " . $customer_details['phone'] . "\n\n";
        
        // Storage Details
        $message .= "Storage Details:\n";
        $message .= "Storage Type: " . sanitize_text_field($_POST['storage_type']) . "\n";
        $message .= "Storage Space: " . sanitize_text_field($_POST['storage_space']) . " sq ft\n";
        $message .= "Duration: " . sanitize_text_field($_POST['storage_duration']) . "\n";
        
        // Additional Services
        $message .= "\nAdditional Services:\n";
        $message .= "Lorry Service: " . (isset($_POST['need_lorry']) ? 'Yes' : 'No') . "\n";
        
        if (isset($_POST['need_lorry']) && $_POST['need_lorry']) {
            $message .= "Vehicle Type: " . sanitize_text_field($_POST['vehicle_type']) . "\n";
            $message .= "Pickup Address: " . sanitize_text_field($_POST['pickup_street']) . ", " 
                     . sanitize_text_field($_POST['pickup_city']) . ", "
                     . sanitize_text_field($_POST['pickup_state']) . " "
                     . sanitize_text_field($_POST['pickup_postcode']) . "\n";
            $message .= "Manpower Required: " . (isset($_POST['need_manpower']) ? 'Yes' : 'No') . "\n";
        }
        
        $message .= "Wrapping Service: " . (isset($_POST['need_wrapping']) ? 'Yes' : 'No') . "\n";
        if (isset($_POST['need_wrapping']) && $_POST['need_wrapping']) {
            $message .= "Number of Items to Wrap: " . sanitize_text_field($_POST['wrapping_items']) . "\n";
        }
        
        // Pricing Details
        $message .= "\nPricing Details:\n";
        $message .= "Total Amount: RM" . number_format(floatval(str_replace(['RM', ','], '', $_POST['total_amount'])), 2) . "\n";

        // Handle file attachments
        $attachments = array();
        
        // Function to handle file upload
        function handle_file_upload($file_key) {
            if (!empty($_FILES[$file_key]['name'])) {
                // Use WordPress media handling
                require_once(ABSPATH . 'wp-admin/includes/file.php');
                require_once(ABSPATH . 'wp-admin/includes/media.php');
                require_once(ABSPATH . 'wp-admin/includes/image.php');

                // Setup the array of supported file types
                $supported_types = array('application/pdf', 'image/jpeg', 'image/png');
                
                // Get the file type of the upload
                $arr_file_type = wp_check_filetype(basename($_FILES[$file_key]['name']));
                $uploaded_type = $arr_file_type['type'];

                // Check if file type is supported
                if (in_array($uploaded_type, $supported_types)) {
                    $upload = wp_handle_upload(
                        $_FILES[$file_key],
                        array('test_form' => false)
                    );

                    if (!isset($upload['error'])) {
                        error_log("File uploaded successfully via WordPress: " . $upload['file']);
                        return $upload['file'];
                    } else {
                        error_log("WordPress upload error: " . $upload['error']);
                    }
                } else {
                    error_log("Invalid file type: " . $uploaded_type);
                }
            }
            return false;
        }

        // Process files based on storage type
        if ($_POST['storage_type'] === 'Personal') {
            $ic_passport = handle_file_upload('ic_or_passport');
            if ($ic_passport) {
                $attachments[] = $ic_passport;
                $message .= "\nAttached Documents:\n";
                $message .= "- IC/Passport\n";
            }
        } else {
            // Business documents
            $business_docs = array(
                'form_9' => 'Form 9',
                'form_49' => 'Form 49 / Section 78',
                'directors_ic' => 'Directors\' ICs',
                'form_24' => 'Form 24 / Section 51'
            );
            
            $message .= "\nAttached Documents:\n";
            foreach ($business_docs as $key => $label) {
                $file_path = handle_file_upload($key);
                if ($file_path) {
                    $attachments[] = $file_path;
                    $message .= "- {$label}\n";
                }
            }
        }

        // When sending email, let's add more debugging:
        $headers = array(
            'Content-Type: text/plain; charset=UTF-8',
            'From: Your Name <your-email@example.com>'
        );

        error_log("Attempting to send email with attachments:");
        error_log("To: " . $to);
        error_log("Subject: " . $subject);
        error_log("Attachments: " . print_r($attachments, true));

        $mail_sent = wp_mail($to, $subject, $message, $headers, $attachments);

        if ($mail_sent) {
            error_log("Email sent successfully");
        } else {
            error_log("Email failed to send");
            // Get the last WordPress error
            $mail_error = function_exists('error_get_last') ? error_get_last() : 'Unknown error';
            error_log("Mail error: " . print_r($mail_error, true));
        }

        // Clean up uploaded files after sending
        foreach ($attachments as $file) {
            unlink($file);
        }

        // Redirect to checkout
        $checkout_url = $order->get_checkout_payment_url();
        wp_redirect($checkout_url);
        exit;
    }
}
add_action('admin_post_nopriv_process_payment', 'handle_form_submission');
add_action('admin_post_process_payment', 'handle_form_submission');

// Add this function to combine all form data before submission
function add_hidden_fields_to_final_form() {
    wp_add_inline_script("jquery", "
        document.addEventListener('DOMContentLoaded', function () {
            // Function to transfer form data to step 3
            function transferFormData() {
                const step1Form = document.getElementById('step1-form');
                const step2Form = document.getElementById('step2-form');
                const step3Form = document.getElementById('step3-form');

                if (step1Form && step2Form && step3Form) {
                    // Transfer data from step 1
                    const step1Fields = step1Form.elements;
                    for (let i = 0; i < step1Fields.length; i++) {
                        const field = step1Fields[i];
                        if (field.name && field.type !== 'button') {
                            // Create hidden input if it doesn't exist
                            let hiddenField = step3Form.querySelector(`input[name=\"${field.name}\"]`);
                            if (!hiddenField) {
                                hiddenField = document.createElement('input');
                                hiddenField.type = 'hidden';
                                hiddenField.name = field.name;
                                step3Form.appendChild(hiddenField);
                            }
                            // Set the value
                            if (field.type === 'checkbox' || field.type === 'radio') {
                                hiddenField.value = field.checked ? field.value || 'on' : '';
                            } else {
                                hiddenField.value = field.value;
                            }
                        }
                    }

                    // Transfer data from step 2
                    const step2Fields = step2Form.elements;
                    for (let i = 0; i < step2Fields.length; i++) {
                        const field = step2Fields[i];
                        if (field.name && field.type !== 'button') {
                            // Create hidden input if it doesn't exist
                            let hiddenField = step3Form.querySelector(`input[name=\"${field.name}\"]`);
                            if (!hiddenField) {
                                hiddenField = document.createElement('input');
                                hiddenField.type = 'hidden';
                                hiddenField.name = field.name;
                                step3Form.appendChild(hiddenField);
                            }
                            // Set the value
                            if (field.type === 'checkbox' || field.type === 'radio') {
                                hiddenField.value = field.checked ? field.value || 'on' : '';
                            } else {
                                hiddenField.value = field.value;
                            }
                        }
                    }

                    // Add fee values as hidden fields
                    const feeElements = {
                        'monthly_rental': '.monthly-rental',
                        'security_deposit': '.security-deposit',
                        'rental_cost': '.rental-cost',
                        'admin_fee': '.admin-fee',
                        'stamping_fee': '.stamping-fee',
                        'lorry_fee': '.lorry-fee',
                        'wrapping_fee': '.wrapping-fee',
                        'total_amount': '.total-amount'
                    };

                    for (const [fieldName, selector] of Object.entries(feeElements)) {
                        const element = document.querySelector(selector);
                        if (element) {
                            let hiddenField = step3Form.querySelector(`input[name=\"${fieldName}\"]`);
                            if (!hiddenField) {
                                hiddenField = document.createElement('input');
                                hiddenField.type = 'hidden';
                                hiddenField.name = fieldName;
                                step3Form.appendChild(hiddenField);
                            }
                            hiddenField.value = element.textContent.replace('RM', '').trim();
                        }
                    }
                }
            }

            // Call transferFormData when clicking next buttons
            const nextButtons = document.querySelectorAll('.next-step');
            nextButtons.forEach(button => {
                button.addEventListener('click', transferFormData);
            });

            // Also call it before form submission
            const step3Form = document.getElementById('step3-form');
            if (step3Form) {
                step3Form.addEventListener('submit', function(e) {
                    transferFormData();
                });
            }
        });
    ");
}
add_action('wp_enqueue_scripts', 'add_hidden_fields_to_final_form');

// Helper function to get price range for space
function get_space_range($space) {
    $space = intval($space);
    if ($space < 21) return '< 21';
    if ($space <= 30) return '21 - 30';
    if ($space <= 50) return '30 - 50';
    if ($space <= 70) return '50 - 70';
    if ($space <= 100) return '70 - 100';
    if ($space <= 200) return '100 - 200';
    return '> 200';
}

// Add validation function
nextStepButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
        e.preventDefault();
        const nextStep = currentStep + 1;
        
        // Validate current form before proceeding
        const currentForm = document.querySelector(`.step-${currentStep + 1} form`);
        if (currentForm) {
            // Reset previous validation messages
            const existingErrors = currentForm.querySelectorAll('.error-message');
            existingErrors.forEach(error => error.remove());
            
            let isValid = true;
            
            // Step 1 specific validation
            if (currentStep === 0) {
                // Storage Type validation
                const storageType = currentForm.querySelector('input[name="storage_type"]:checked');
                if (!storageType) {
                    isValid = false;
                    addErrorMessage(currentForm.querySelector('input[name="storage_type"]'), 'Please select a storage type');
                }
                
                // Salutation validation
                const salutation = currentForm.querySelector('select[name="salutation"]');
                if (salutation && salutation.value === "") {
                    isValid = false;
                    addErrorMessage(salutation, 'Please select a salutation');
                }
                
                // Email validation
                const email = currentForm.querySelector('input[name="email"]');
                if (email && !isValidEmail(email.value)) {
                    isValid = false;
                    addErrorMessage(email, 'Please enter a valid email address');
                }
                
                // Phone validation
                const phone = currentForm.querySelector('input[name="phone"]');
                if (phone && !isValidPhone(phone.value)) {
                    isValid = false;
                    addErrorMessage(phone, 'Please enter a valid phone number');
                }
                
                // Storage Space validation
                const storageSpace = currentForm.querySelector('input[name="storage_space"]');
                if (storageSpace && (isNaN(storageSpace.value) || storageSpace.value <= 0)) {
                    isValid = false;
                    addErrorMessage(storageSpace, 'Please enter a valid storage space');
                }
                
                // Storage Duration validation
                const duration = currentForm.querySelector('select[name="storage_duration"]');
                if (duration && duration.value === "") {
                    isValid = false;
                    addErrorMessage(duration, 'Please select a storage duration');
                }
                
                // Store Location validation
                const location = currentForm.querySelector('select[name="store_location"]');
                if (location && location.value === "") {
                    isValid = false;
                    addErrorMessage(location, 'Please select a store location');
                }
            }
            
            // Step 2 specific validation
            if (currentStep === 1) {
                // Consent validation
                const consent = currentForm.querySelector('input[name="consent"]:checked');
                if (!consent) {
                    isValid = false;
                    addErrorMessage(currentForm.querySelector('input[name="consent"]'), 'Please select your consent preference');
                }
                
                // Agreement validation
                const agreement = currentForm.querySelector('input[name="agreement"]');
                if (!agreement.checked) {
                    isValid = false;
                    addErrorMessage(agreement, 'You must agree to the terms and conditions');
                }
                
                // Business fields validation if Business type selected
                const storageType = document.querySelector('input[name="storage_type"]:checked');
                if (storageType && storageType.value === 'Business') {
                    const businessName = currentForm.querySelector('input[name="business_name"]');
                    const regNo = currentForm.querySelector('input[name="company_reg_no"]');
                    
                    if (!businessName.value.trim()) {
                        isValid = false;
                        addErrorMessage(businessName, 'Please enter your business name');
                    }
                    if (!regNo.value.trim()) {
                        isValid = false;
                        addErrorMessage(regNo, 'Please enter your company registration number');
                    }
                }
            }
            
            // Step 3 specific validation
            if (currentStep === 2) {
                const storageType = document.querySelector('input[name="storage_type"]:checked');
                
                if (storageType.value === 'Personal') {
                    const icPassport = currentForm.querySelector('input[name="ic_or_passport"]');
                    if (!icPassport.files.length) {
                        isValid = false;
                        addErrorMessage(icPassport, 'Please upload your IC or Passport');
                    }
                } else if (storageType.value === 'Business') {
                    const requiredDocs = ['form_9', 'form_49', 'directors_ic', 'form_24'];
                    requiredDocs.forEach(doc => {
                        const input = currentForm.querySelector(`input[name="${doc}"]`);
                        if (!input.files.length) {
                            isValid = false;
                            addErrorMessage(input, 'This document is required');
                        }
                    });
                }
            }
            
            if (!isValid) {
                return;
            }
        }
        
        // If validation passes, proceed with existing logic
        if (currentStep === 0) {
            try {
                button.disabled = true;
                button.textContent = 'Calculating...';
                await fetchLalamovePrice();
                if (nextStep < steps.length) {
                    showStep(nextStep);
                }
            } catch (error) {
                console.error('Error during price calculation:', error);
            } finally {
                button.disabled = false;
                button.textContent = 'Next';
            }
        } else {
            if (nextStep < steps.length) {
                showStep(nextStep);
            }
        }
    });
});

// Helper functions for validation
function addErrorMessage(element, message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message text-danger';
    errorDiv.textContent = message;
    element.parentNode.appendChild(errorDiv);
    element.classList.add('is-invalid');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^[\d\s\-+()]{8,}$/.test(phone);
}

// Add CSS for validation
const style = document.createElement('style');
style.textContent = `
    .error-message {
        font-size: 0.8rem;
        margin-top: 0.25rem;
    }
    .is-invalid {
        border-color: #dc3545 !important;
    }
`;
document.head.appendChild(style);

// Add form validation JavaScript
function add_form_validation_js() {
    wp_add_inline_script('jquery', '
        document.addEventListener("DOMContentLoaded", function() {
            const nextStepButtons = document.querySelectorAll(".next-step");
            
            function addErrorMessage(element, message) {
                const errorDiv = document.createElement("div");
                errorDiv.className = "error-message text-danger";
                errorDiv.textContent = message;
                element.parentNode.appendChild(errorDiv);
                element.classList.add("is-invalid");
            }

            function isValidEmail(email) {
                return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
            }

            function isValidPhone(phone) {
                return /^[\\d\\s\\-+()]{8,}$/.test(phone);
            }

            function validateForm(currentStep, currentForm) {
                // Reset previous validation messages
                const existingErrors = currentForm.querySelectorAll(".error-message");
                existingErrors.forEach(error => error.remove());
                
                let isValid = true;
                
                // Step 1 validation
                if (currentStep === 0) {
                    const storageType = currentForm.querySelector("input[name=\\"storage_type\\"]:checked");
                    if (!storageType) {
                        isValid = false;
                        addErrorMessage(currentForm.querySelector("input[name=\\"storage_type\\"]"), "Please select a storage type");
                    }
                    
                    const salutation = currentForm.querySelector("select[name=\\"salutation\\"]");
                    if (salutation && salutation.value === "") {
                        isValid = false;
                        addErrorMessage(salutation, "Please select a salutation");
                    }
                    
                    const email = currentForm.querySelector("input[name=\\"email\\"]");
                    if (email && !isValidEmail(email.value)) {
                        isValid = false;
                        addErrorMessage(email, "Please enter a valid email address");
                    }
                    
                    const phone = currentForm.querySelector("input[name=\\"phone\\"]");
                    if (phone && !isValidPhone(phone.value)) {
                        isValid = false;
                        addErrorMessage(phone, "Please enter a valid phone number");
                    }
                }
                
                // Step 2 validation
                if (currentStep === 1) {
                    const consent = currentForm.querySelector("input[name=\\"consent\\"]:checked");
                    if (!consent) {
                        isValid = false;
                        addErrorMessage(currentForm.querySelector("input[name=\\"consent\\"]"), "Please select your consent preference");
                    }
                    
                    const agreement = currentForm.querySelector("input[name=\\"agreement\\"]");
                    if (!agreement.checked) {
                        isValid = false;
                        addErrorMessage(agreement, "You must agree to the terms and conditions");
                    }
                }
                
                // Step 3 validation
                if (currentStep === 2) {
                    const storageType = document.querySelector("input[name=\\"storage_type\\"]:checked");
                    
                    if (storageType.value === "Personal") {
                        const icPassport = currentForm.querySelector("input[name=\\"ic_or_passport\\"]");
                        if (!icPassport.files.length) {
                            isValid = false;
                            addErrorMessage(icPassport, "Please upload your IC or Passport");
                        }
                    } else if (storageType.value === "Business") {
                        const requiredDocs = ["form_9", "form_49", "directors_ic", "form_24"];
                        requiredDocs.forEach(doc => {
                            const input = currentForm.querySelector(`input[name="${doc}"]`);
                            if (!input.files.length) {
                                isValid = false;
                                addErrorMessage(input, "This document is required");
                            }
                        });
                    }
                }
                
                return isValid;
            }

            // Add validation to next step buttons
            nextStepButtons.forEach(button => {
                button.addEventListener("click", function(e) {
                    const currentStep = parseInt(this.closest(".step-content").className.match(/step-(\d+)/)[1]) - 1;
                    const currentForm = this.closest("form");
                    
                    if (!validateForm(currentStep, currentForm)) {
                        e.preventDefault();
                        return false;
                    }
                });
            });
        });
    ');

    // Add validation styles
    wp_add_inline_style('parent-style', '
        .error-message {
            font-size: 0.8rem;
            margin-top: 0.25rem;
            color: #dc3545;
        }
        .is-invalid {
            border-color: #dc3545 !important;
        }
    ');
}
add_action('wp_enqueue_scripts', 'add_form_validation_js');